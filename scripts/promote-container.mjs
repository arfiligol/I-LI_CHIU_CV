/**
 * Promotes one already-published main image to the generated Portainer branch.
 * It deliberately accepts no mutable tag and refuses to replace unexpected
 * generated-branch contents. GitHub's non-force ref update is the concurrency
 * boundary for deploy/production; main is rechecked immediately before update.
 */
import { readFile } from 'node:fs/promises';

const repository = required('GITHUB_REPOSITORY', /^[\w.-]+\/[\w.-]+$/);
const token = required('GITHUB_TOKEN');
const sourceSha = required('GITHUB_SHA', /^[0-9a-f]{40}$/i).toLowerCase();
const imageDigest = required('IMAGE_DIGEST', /^sha256:[0-9a-f]{64}$/i).toLowerCase();
const runId = required('GITHUB_RUN_ID', /^\d+$/);
const workflowUrl = `https://github.com/${repository}/actions/runs/${runId}`;
const generatedBranch = 'deploy/production';
const imagePlaceholder = '"${CV_IMAGE:?Set CV_IMAGE to the published GHCR image digest}"';

function required(name, pattern) {
  const value = process.env[name];
  if (!value || (pattern && !pattern.test(value))) {
    throw new Error(`Missing or invalid ${name}.`);
  }
  return value;
}

async function api(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body.message === 'string' ? ` ${body.message}` : '';
    const error = new Error(`GitHub API ${options.method ?? 'GET'} ${path} failed (${response.status}).${detail}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function getRef(branch) {
  try {
    return await api(`/git/ref/heads/${branch}`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

function decodeContent(resource, label) {
  if (resource?.type !== 'file' || resource.encoding !== 'base64' || typeof resource.content !== 'string') {
    throw new Error(`${label} has an unexpected GitHub contents shape.`);
  }
  return Buffer.from(resource.content, 'base64').toString('utf8');
}

function renderCompose(canonicalCompose, digest) {
  const placeholders = canonicalCompose.split(imagePlaceholder).length - 1;
  if (placeholders !== 1) {
    throw new Error('Canonical compose.yaml must contain exactly one quoted CV_IMAGE placeholder.');
  }
  const rendered = canonicalCompose.replace(
    imagePlaceholder,
    `"ghcr.io/arfiligol/i-li-chiu-cv@${digest.toLowerCase()}"`,
  );
  if (rendered.includes('${CV_IMAGE')) {
    throw new Error('Rendered compose.yaml retains a CV_IMAGE interpolation.');
  }
  return rendered;
}

async function getBranchFiles(commitSha) {
  const commit = await api(`/git/commits/${commitSha}`);
  const tree = await api(`/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated) throw new Error('Generated branch tree is unexpectedly truncated.');
  const files = [...tree.tree].sort((left, right) => left.path.localeCompare(right.path));
  if (
    files.length !== 2 ||
    files[0].path !== 'compose.yaml' ||
    files[1].path !== 'release.json' ||
    files.some((entry) => entry.type !== 'blob' || entry.mode !== '100644')
  ) {
    throw new Error('Generated branch has an unexpected shape; refusing to replace its contents.');
  }
  const [release, compose] = await Promise.all([
    api(`/contents/release.json?ref=${encodeURIComponent(commitSha)}`),
    api(`/contents/compose.yaml?ref=${encodeURIComponent(commitSha)}`),
  ]);
  let parsed;
  try {
    parsed = JSON.parse(decodeContent(release, 'Generated branch release.json'));
  } catch {
    throw new Error('Generated branch release.json is not valid JSON.');
  }
  if (!/^[0-9a-f]{40}$/i.test(parsed?.source_sha) || !/^sha256:[0-9a-f]{64}$/i.test(parsed?.image_digest) || typeof parsed?.workflow_url !== 'string') {
    throw new Error('Generated branch release.json has an unexpected provenance shape.');
  }
  const sourceCompose = decodeContent(
    await api(`/contents/compose.yaml?ref=${encodeURIComponent(parsed.source_sha)}`),
    `Source compose.yaml at ${parsed.source_sha}`,
  );
  if (decodeContent(compose, 'Generated branch compose.yaml') !== renderCompose(sourceCompose, parsed.image_digest)) {
    throw new Error('Generated branch compose.yaml does not match its immutable release provenance.');
  }
  return { commit, parsed };
}

async function createBlob(content) {
  const result = await api('/git/blobs', {
    method: 'POST',
    body: JSON.stringify({ content, encoding: 'utf-8' }),
  });
  return result.sha;
}

const actualCompose = await readFile(new URL('../compose.yaml', import.meta.url), 'utf8');
const renderedCompose = renderCompose(actualCompose, imageDigest);
const releaseJson = `${JSON.stringify({
  source_sha: sourceSha,
  image_digest: imageDigest,
  workflow_url: workflowUrl,
}, null, 2)}\n`;

const existingRef = await getRef(generatedBranch);
let parentSha;
let baseTree;
if (existingRef) {
  parentSha = existingRef.object.sha;
  const existing = await getBranchFiles(parentSha);
  if (existing.parsed?.source_sha === sourceSha && existing.parsed?.image_digest === imageDigest) {
    console.log(`deploy/production already records ${sourceSha} and ${imageDigest}; no update needed.`);
    process.exit(0);
  }
  baseTree = existing.commit.tree.sha;
}

const [composeBlob, releaseBlob] = await Promise.all([createBlob(renderedCompose), createBlob(releaseJson)]);
const tree = await api('/git/trees', {
  method: 'POST',
  body: JSON.stringify({
    base_tree: baseTree,
    tree: [
      { path: 'compose.yaml', mode: '100644', type: 'blob', sha: composeBlob },
      { path: 'release.json', mode: '100644', type: 'blob', sha: releaseBlob },
    ],
  }),
});
const commit = await api('/git/commits', {
  method: 'POST',
  body: JSON.stringify({
    message: `deploy: promote ${sourceSha.slice(0, 12)}`,
    tree: tree.sha,
    parents: parentSha ? [parentSha] : [],
  }),
});

// This is deliberately the final main read before updating the deployment ref.
const mainBeforeUpdate = await getRef('main');
if (!mainBeforeUpdate || mainBeforeUpdate.object.sha.toLowerCase() !== sourceSha) {
  console.log(`main no longer names ${sourceSha}; skipping deployment-branch update.`);
  process.exit(0);
}

try {
  if (existingRef) {
    await api(`/git/refs/heads/${generatedBranch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
  } else {
    await api('/git/refs', {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${generatedBranch}`, sha: commit.sha }),
    });
  }
} catch (error) {
  throw new Error(`Deployment branch changed concurrently or could not be created; no overwrite was attempted. ${error.message}`);
}

console.log(`Updated deploy/production with ${sourceSha} and ${imageDigest}.`);
