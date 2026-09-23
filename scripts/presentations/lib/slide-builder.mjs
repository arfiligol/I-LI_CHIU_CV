import fs from "node:fs/promises";

const PALETTES = {
  "tech-slate": {
    light: {
      background: "#FAFAFA",
      surface: "#FFFFFF",
      text: "#2D3748",
      muted: "#718096",
      accent: "#3182CE",
      rule: "#CBD5E0",
      red: "#E53E3E",
      green: "#2F855A",
      amber: "#D69E2E",
    },
    dark: {
      background: "#1A202C",
      surface: "#2D3748",
      text: "#E2E8F0",
      muted: "#A0AEC0",
      accent: "#3182CE",
      rule: "#4A5568",
      red: "#FC8181",
      green: "#68D391",
      amber: "#F6AD55",
    },
  },
};

const SPEC_CACHE = new Map();
const EQUATION_CARD_PT_SCALE = 2.5;
const SYMBOL_CHIP_PT_SCALE = 2.25;

async function loadSpec(specPath) {
  if (!SPEC_CACHE.has(specPath)) {
    SPEC_CACHE.set(specPath, JSON.parse(await fs.readFile(specPath, "utf8")));
  }
  return SPEC_CACHE.get(specPath);
}

export async function buildSlideFromSpec(presentation, ctx, specPath, index) {
  const spec = await loadSpec(specPath);
  const slideDef = spec.slides[index];
  if (!slideDef) throw new Error(`Missing slide at index ${index}`);

  const slide = presentation.slides.add();
  const palette = resolvePalette(spec, slideDef);
  addBackground(slide, ctx, palette);

  switch (slideDef.layout) {
    case "cover":
      await buildCover(slide, ctx, spec, slideDef, palette);
      break;
    case "section":
      await buildSection(slide, ctx, spec, slideDef, palette, index);
      break;
    case "workflow":
      await buildWorkflow(slide, ctx, spec, slideDef, palette);
      break;
    case "loss_tree":
      await buildLossTree(slide, ctx, spec, slideDef, palette);
      break;
    case "circuit_question":
      await buildCircuitQuestion(slide, ctx, spec, slideDef, palette);
      break;
    case "route_workflow":
      await buildRouteWorkflow(slide, ctx, spec, slideDef, palette);
      break;
    case "derivation_stack":
      await buildDerivationStack(slide, ctx, spec, slideDef, palette);
      break;
    case "comparison":
      await buildComparison(slide, ctx, spec, slideDef, palette);
      break;
    case "figure":
      await buildFigure(slide, ctx, spec, slideDef, palette);
      break;
    case "evidence_pair":
      await buildEvidencePair(slide, ctx, spec, slideDef, palette);
      break;
    case "result_focus":
      await buildResultFocus(slide, ctx, spec, slideDef, palette);
      break;
    case "two_figures":
      await buildTwoFigures(slide, ctx, spec, slideDef, palette);
      break;
    case "table":
      await buildTableSlide(slide, ctx, spec, slideDef, palette);
      break;
    case "appendix_index":
      await buildAppendixIndex(slide, ctx, spec, slideDef, palette);
      break;
    case "references":
      await buildReferences(slide, ctx, spec, slideDef, palette);
      break;
    case "concept":
    default:
      await buildConcept(slide, ctx, spec, slideDef, palette);
      break;
  }

  await addSymbolKey(slide, ctx, spec, slideDef, palette);
  addFooter(slide, ctx, slideDef, palette, index + 1);
  return slide;
}

function resolvePalette(spec, slideDef) {
  const theme = spec.theme || {};
  const family = PALETTES[theme.id || "tech-slate"] || PALETTES["tech-slate"];
  const mode = slideDef.mode || theme.mode || "light";
  return family[mode] || family.light;
}

function addBackground(slide, ctx, palette) {
  ctx.addShape(slide, {
    x: 0,
    y: 0,
    width: ctx.W,
    height: ctx.H,
    fill: palette.background,
    line: ctx.line(),
  });
}

function text(slide, ctx, palette, value, x, y, width, height, options = {}) {
  return ctx.addText(slide, {
    text: plainText(value),
    x,
    y,
    width,
    height,
    fontSize: options.size || 20,
    color: options.color || palette.text,
    bold: options.bold || false,
    typeface: options.face || "Helvetica Neue",
    align: options.align || "left",
    valign: options.valign || "top",
    fill: options.fill || "#00000000",
    line: options.line || ctx.line(),
    insets: options.insets || { left: 0, right: 0, top: 0, bottom: 0 },
    name: options.name,
  });
}

function plainText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value.parts)) {
    return value.parts.map((part) => part.text || part.formula || "").join("");
  }
  return String(value);
}

async function richText(slide, ctx, spec, palette, value, x, y, width, height, options = {}) {
  if (!value || typeof value === "string" || !Array.isArray(value.parts)) {
    text(slide, ctx, palette, value, x, y, width, height, options);
    return;
  }
  const size = options.size || 20;
  const color = options.color || palette.text;
  const symbolScale = options.symbolScale || SYMBOL_CHIP_PT_SCALE;
  const parts = value.parts.map((part) => {
    if (part.formula) {
      const dimensions = equationDimensions(spec.equation_assets?.[part.formula], symbolScale);
      return { ...part, width: dimensions.width, height: dimensions.height, dimensions };
    }
    const label = part.text || "";
    return { ...part, width: estimateTextWidth(label, size), height: size * 1.35, label };
  });
  const gap = options.partGap ?? 8;
  const totalWidth = parts.reduce((sum, part, index) => sum + part.width + (index ? gap : 0), 0);
  const totalHeight = Math.max(...parts.map((part) => part.height), size * 1.35);
  const startX = options.align === "center" ? x + (width - totalWidth) / 2 : x;
  const startY = y + (height - totalHeight) / 2;
  let cursorX = startX;
  for (const part of parts) {
    if (part.formula) {
      await addEquationImage(slide, ctx, spec, part.formula, cursorX, startY + (totalHeight - part.height) / 2, part.width, part.height, {
        scale: symbolScale,
      });
    } else {
      text(slide, ctx, palette, part.label, cursorX, startY, part.width + 4, totalHeight, {
        ...options,
        size,
        color,
        valign: "middle",
        align: "left",
      });
    }
    cursorX += part.width + gap;
  }
}

function estimateTextWidth(value, size) {
  return Math.max(8, value.length * size * 0.52);
}

function equationDimensions(asset, scale) {
  const widthPt = Number(asset?.canvas_width_pt || asset?.raw_svg_width_pt || 24);
  const heightPt = Number(asset?.canvas_height_pt || asset?.raw_svg_height_pt || 24);
  return {
    width: widthPt * scale,
    height: heightPt * scale,
  };
}

async function addEquationImage(slide, ctx, spec, equationId, x, y, width, height, options = {}) {
  const asset = spec.equation_assets?.[equationId];
  if (!asset?.png_path) return;
  const dimensions = equationDimensions(asset, options.scale || EQUATION_CARD_PT_SCALE);
  await ctx.addImage(slide, {
    path: asset.png_path,
    x,
    y,
    width: width ?? dimensions.width,
    height: height ?? dimensions.height,
    fit: "contain",
    alt: asset.title || equationId,
  });
}

function box(slide, ctx, palette, x, y, width, height, options = {}) {
  return ctx.addShape(slide, {
    x,
    y,
    width,
    height,
    geometry: options.geometry || "roundRect",
    fill: options.fill || palette.surface,
    line: options.line === false ? ctx.line() : ctx.line(options.stroke || palette.rule, options.strokeWidth || 1),
    name: options.name,
  });
}

function rule(slide, ctx, palette, x, y, width, height = 2, color = palette.accent) {
  ctx.addShape(slide, {
    x,
    y,
    width,
    height,
    geometry: "rect",
    fill: color,
    line: ctx.line(),
  });
}

function nodeDot(slide, ctx, palette, x, y, options = {}) {
  const size = options.size || 11;
  ctx.addShape(slide, {
    x: x - size / 2,
    y: y - size / 2,
    width: size,
    height: size,
    geometry: "ellipse",
    fill: options.fill || palette.text,
    line: ctx.line(options.stroke || options.fill || palette.text, options.strokeWidth || 1),
  });
}

function groundSymbol(slide, ctx, palette, x, y, color = palette.text) {
  rule(slide, ctx, palette, x - 20, y, 40, 3, color);
  rule(slide, ctx, palette, x - 14, y + 8, 28, 3, color);
  rule(slide, ctx, palette, x - 8, y + 16, 16, 3, color);
}

function verticalCapacitor(slide, ctx, palette, x, y, options = {}) {
  const color = options.color || palette.text;
  const plateW = options.plateWidth || 54;
  const gap = options.gap || 14;
  rule(slide, ctx, palette, x, y - 54, 3, 54, color);
  rule(slide, ctx, palette, x - plateW / 2, y, plateW, 4, color);
  rule(slide, ctx, palette, x - plateW / 2, y + gap, plateW, 4, color);
  rule(slide, ctx, palette, x, y + gap + 4, 3, 50, color);
}

function horizontalCapacitor(slide, ctx, palette, x, y, options = {}) {
  const color = options.color || palette.text;
  const plateH = options.plateHeight || 62;
  const gap = options.gap || 14;
  rule(slide, ctx, palette, x - 74, y, 74, 3, color);
  rule(slide, ctx, palette, x, y - plateH / 2, 4, plateH, color);
  rule(slide, ctx, palette, x + gap, y - plateH / 2, 4, plateH, color);
  rule(slide, ctx, palette, x + gap + 4, y, 80, 3, color);
}

function addKicker(slide, ctx, palette, kicker, x = 64, y = 42) {
  if (!kicker) return;
  rule(slide, ctx, palette, x, y + 11, 34, 4, palette.accent);
  text(slide, ctx, palette, kicker.toUpperCase(), x + 46, y, 560, 30, {
    size: 18,
    color: palette.muted,
    bold: true,
    valign: "middle",
  });
}

function addTitle(slide, ctx, palette, slideDef, width = 760) {
  text(slide, ctx, palette, slideDef.title, 64, 42, width, 104, {
    size: 42,
    bold: true,
    valign: "middle",
  });
  if (slideDef.subtitle) {
    text(slide, ctx, palette, slideDef.subtitle, 66, 134, width, 36, {
      size: 24,
      color: palette.muted,
    });
  }
}

function addFooter(slide, ctx, slideDef, palette, number) {
  const footer = plainText(slideDef.footer);
  const showFootnote = /literature|krantz|sete|levenson/i.test(footer);
  if (showFootnote) {
    rule(slide, ctx, palette, 64, 680, 34, 2, palette.rule);
    text(slide, ctx, palette, footer, 108, 668, 820, 28, {
      size: 14,
      color: palette.muted,
    });
  }
  if (number > 1) {
    text(slide, ctx, palette, String(number).padStart(2, "0"), 1170, 668, 46, 28, {
      size: 16,
      color: palette.muted,
      align: "right",
    });
  }
}

async function addBullets(slide, ctx, spec, palette, items, x, y, width, options = {}) {
  const size = options.size || 28;
  const lineHeight = options.lineHeight || 72;
  const visibleItems = items.slice(0, options.maxItems || items.length);
  for (let index = 0; index < visibleItems.length; index += 1) {
    const item = visibleItems[index];
    const yy = y + index * lineHeight;
    ctx.addShape(slide, {
      x,
      y: yy + 16,
      width: 12,
      height: 12,
      geometry: "rect",
      fill: options.dotColor || palette.accent,
      line: ctx.line(),
    });
    await richText(slide, ctx, spec, palette, item, x + 28, yy, width - 28, lineHeight - 2, {
      size,
      color: options.color || palette.text,
      valign: "middle",
      symbolScale: options.symbolScale,
    });
  }
}

async function addCalloutRail(slide, ctx, spec, palette, items, x, y, width, options = {}) {
  const visibleItems = items.slice(0, options.maxItems || 4);
  for (let index = 0; index < visibleItems.length; index += 1) {
    const item = visibleItems[index];
    const yy = y + index * (options.gap || 118);
    const height = options.height || 72;
    rule(slide, ctx, palette, x, yy + 12, 4, Math.max(36, height - 24), palette.accent);
    richText(slide, ctx, spec, palette, item, x + 22, yy + 8, width - 28, height - 16, {
      size: options.size || 28,
      color: palette.text,
      valign: "middle",
      symbolScale: options.symbolScale,
    });
  }
}

async function addMetricRail(slide, ctx, spec, palette, metrics, x, y, width) {
  const visibleMetrics = metrics.slice(0, 4);
  for (let index = 0; index < visibleMetrics.length; index += 1) {
    const metric = visibleMetrics[index];
    const yy = y + index * 112;
    rule(slide, ctx, palette, x, yy, width, 1, palette.rule);
    await richText(slide, ctx, spec, palette, metric.label, x, yy + 13, width, 18, {
      size: 11,
      color: palette.muted,
      bold: true,
      valign: "middle",
    });
    await richText(slide, ctx, spec, palette, metric.value, x, yy + 38, width, 24, {
      size: 19,
      bold: true,
      valign: "middle",
    });
    if (metric.context) {
      await richText(slide, ctx, spec, palette, metric.context, x, yy + 65, width, 14, {
        size: 9,
        color: palette.muted,
        valign: "middle",
      });
    }
  }
}

async function addEquationCard(slide, ctx, spec, palette, equationId, x, y, width, height, label) {
  const asset = spec.equation_assets?.[equationId];
  rule(slide, ctx, palette, x, y, width, 1, palette.rule);
  if (label) {
    await richText(slide, ctx, spec, palette, label, x, y + 12, width, 24, {
      size: 18,
      color: palette.muted,
      bold: true,
      valign: "middle",
    });
  }
  if (!asset?.png_path) {
    text(slide, ctx, palette, `Missing equation: ${equationId}`, x + 18, y + 46, width - 36, 30, {
      size: 22,
      color: palette.red,
    });
    return;
  }
  const top = y + (label ? 48 : 14);
  const availableHeight = height - (label ? 58 : 28);
  const dimensions = equationDimensions(asset, EQUATION_CARD_PT_SCALE);
  await addEquationImage(
    slide,
    ctx,
    spec,
    equationId,
    x + (width - dimensions.width) / 2,
    top + (availableHeight - dimensions.height) / 2,
    dimensions.width,
    dimensions.height,
  );
}

async function addSymbolKey(slide, ctx, spec, slideDef, palette) {
  const position = slideDef.symbol_key_position || "bottom";
  if (position === "none") return;
  const entries = (slideDef.symbol_key || [])
    .map((symbolId) => ({ id: symbolId, ...(spec.symbol_registry?.[symbolId] || {}) }))
    .filter((entry) => entry.formula && entry.meaning);
  if (!entries.length) return;

  const isRight = position === "right";
  const isTop = position === "top";
  const isEvidencePair = !isRight && !isTop && slideDef.layout === "evidence_pair";
  const boxSpec = isRight
    ? { x: 930, y: 156, width: 282, cols: 1, rowH: 34, titleW: 72 }
    : isTop
      ? {
          x: 64,
          y: 124,
          width: 1080,
          cols: entries.length > 1 ? Math.min(4, entries.length) : 1,
          rowH: 38,
          titleW: 104,
        }
    : isEvidencePair
      ? {
          x: 66,
          y: 642,
          width: 540,
          cols: entries.length > 1 ? Math.min(3, entries.length) : 1,
          rowH: 38,
          titleW: 104,
        }
    : {
        x: 64,
        y: entries.length > 8 ? 548 : entries.length > 4 ? 570 : 612,
        width: 1080,
        cols: entries.length > 1 ? Math.min(4, entries.length) : 1,
        rowH: 40,
        titleW: 104,
      };
  const rows = Math.ceil(entries.length / boxSpec.cols);
  const height = rows * boxSpec.rowH + 12;

  rule(slide, ctx, palette, boxSpec.x, boxSpec.y, boxSpec.width, 1, palette.rule);
  text(slide, ctx, palette, "Symbol key", boxSpec.x, boxSpec.y + 7, boxSpec.titleW, 28, {
    size: isRight ? 14 : 16,
    color: palette.muted,
    bold: true,
    valign: "middle",
  });

  const itemX = boxSpec.x + boxSpec.titleW + 12;
  const itemWidth = (boxSpec.width - boxSpec.titleW - 16) / boxSpec.cols;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const col = index % boxSpec.cols;
    const row = Math.floor(index / boxSpec.cols);
    const asset = spec.equation_assets?.[entry.formula];
    const x = itemX + col * itemWidth;
    const y = boxSpec.y + 6 + row * boxSpec.rowH;
    const baseScale = isRight ? 0.92 : isEvidencePair ? 0.86 : 1.08;
    let dimensions = equationDimensions(asset, baseScale);
    const maxFormulaWidth = isRight ? 112 : isEvidencePair ? 120 : Math.min(140, itemWidth * 0.48);
    if (dimensions.width > maxFormulaWidth) {
      dimensions = equationDimensions(asset, baseScale * (maxFormulaWidth / dimensions.width));
    }
    await addEquationImage(
      slide,
      ctx,
      spec,
      entry.formula,
      x,
      y + (boxSpec.rowH - dimensions.height) / 2,
      dimensions.width,
      dimensions.height,
    );
    text(slide, ctx, palette, `: ${entry.meaning}`, x + dimensions.width + 6, y, itemWidth - dimensions.width - 12, boxSpec.rowH - 2, {
      size: isRight ? 14 : 16,
      color: palette.muted,
      valign: "middle",
    });
  }

  if (isRight) {
    rule(slide, ctx, palette, boxSpec.x, boxSpec.y, 1, height, palette.rule);
  }
}

async function addFigure(slide, ctx, spec, palette, figure, x, y, width, height) {
  const asset = spec.assets?.[figure.asset];
  if (!asset?.resolved_path) {
    box(slide, ctx, palette, x, y, width, height);
    text(slide, ctx, palette, `Missing figure: ${figure.asset}`, x + 20, y + 20, width - 40, 24, {
      size: 26,
      color: palette.red,
    });
    return;
  }
  await ctx.addImage(slide, {
    path: asset.resolved_path,
    x,
    y,
    width,
    height: height - (figure.caption ? 34 : 0),
    fit: figure.fit || "contain",
    alt: asset.alt,
  });
  if (figure.caption) {
    await richText(slide, ctx, spec, palette, figure.caption, x, y + height - 30, width, 30, {
      size: 16,
      color: palette.muted,
      valign: "middle",
      symbolScale: 1.15,
    });
  }
}

async function buildCover(slide, ctx, spec, slideDef, palette) {
  const metadata = spec.metadata || {};
  const defenseLabel = metadata.defense_label || slideDef.subtitle || metadata.subtitle || "Undergraduate Thesis Defense";
  rule(slide, ctx, palette, 74, 82, 96, 4, palette.accent);
  text(slide, ctx, palette, defenseLabel.toUpperCase(), 74, 112, 720, 34, {
    size: 22,
    color: palette.muted,
    bold: true,
  });
  text(slide, ctx, palette, slideDef.title, 72, 154, 730, 270, {
    size: 58,
    bold: true,
  });

  const details = [
    ["Candidate", metadata.author],
    ["Advisor", metadata.advisor],
    ["Department", metadata.department],
    ["Institution", metadata.institution],
    ["Year", metadata.year || metadata.date],
  ].filter(([, value]) => value);
  rule(slide, ctx, palette, 814, 150, 4, 400, palette.accent);
  details.forEach(([label, value], index) => {
    const yy = 180 + index * 72;
    text(slide, ctx, palette, label.toUpperCase(), 846, yy, 300, 24, {
      size: 16,
      color: palette.muted,
      bold: true,
    });
    text(slide, ctx, palette, value, 846, yy + 28, 300, 34, {
      size: index === 0 ? 28 : 22,
      bold: index === 0,
      color: palette.text,
    });
  });

  if (slideDef.callouts?.length) {
    await addCalloutRail(slide, ctx, spec, palette, slideDef.callouts, 76, 492, 650, {
      gap: 72,
      height: 58,
      size: 13,
      maxItems: 2,
    });
  }
}

async function buildSection(slide, ctx, spec, slideDef, palette, index) {
  addKicker(slide, ctx, palette, slideDef.kicker || `Section ${index + 1}`, 76, 76);
  text(slide, ctx, palette, slideDef.title, 76, 150, 720, 210, {
    size: 58,
    bold: true,
  });
  if (slideDef.body?.length) {
    await richText(slide, ctx, spec, palette, slideDef.body[0], 82, 382, 690, 110, {
      size: 30,
      color: palette.muted,
      valign: "middle",
    });
  }
  await addCalloutRail(slide, ctx, spec, palette, slideDef.callouts || slideDef.bullets || [], 840, 128, 360, {
    gap: 152,
    height: 124,
    size: 25,
    maxItems: 3,
  });
}

async function buildConcept(slide, ctx, spec, slideDef, palette) {
  addTitle(slide, ctx, palette, slideDef, 1080);
  const hasRightRail =
    slideDef.equations?.length ||
    slideDef.figures?.length ||
    slideDef.columns?.some((column) => column.equation);
  const leftWidth = hasRightRail ? 620 : 980;
  if (slideDef.body?.length) {
    await richText(slide, ctx, spec, palette, slideDef.body[0], 66, 154, leftWidth, 108, {
      size: 28,
      color: palette.muted,
      valign: "middle",
    });
  }
  if (slideDef.bullets?.length) {
    await addBullets(slide, ctx, spec, palette, slideDef.bullets, 76, 286, leftWidth, {
      size: 27,
      lineHeight: 84,
      maxItems: 3,
    });
  }
  if (slideDef.columns?.length) {
    const columnWidth = Math.min(500, (1080 - 36 * (slideDef.columns.length - 1)) / slideDef.columns.length);
    const visibleColumns = slideDef.columns.slice(0, 3);
    for (let index = 0; index < visibleColumns.length; index += 1) {
      const column = visibleColumns[index];
      const x = 74 + index * (columnWidth + 36);
      rule(slide, ctx, palette, x, 200, 5, 300, index === 0 ? palette.accent : index === 1 ? palette.red : palette.green);
      await richText(slide, ctx, spec, palette, column.title || "", x + 24, 206, columnWidth - 24, 54, {
        size: 28,
        bold: true,
        valign: "middle",
      });
      const entries = column.bullets?.length ? column.bullets : column.body || [];
      await addBullets(slide, ctx, spec, palette, entries, x + 26, 286, columnWidth - 26, {
        size: 23,
        lineHeight: 64,
        maxItems: 3,
      });
    }
  }
  if (slideDef.equations?.length) {
    const cards = slideDef.equations.slice(0, 4);
    const reserveSymbolKey = Boolean(slideDef.symbol_key?.length);
    const cardH =
      reserveSymbolKey && cards.length === 3
        ? 132
        : cards.length >= 4
          ? 118
          : cards.length === 1
            ? 260
            : cards.length === 2
              ? 202
              : 160;
    const gap = cards.length >= 4 ? 10 : cards.length === 3 ? 8 : 20;
    const yStart = cards.length >= 4 ? 154 : cards.length === 3 ? 150 : 166;
    for (let index = 0; index < cards.length; index += 1) {
      await addEquationCard(
        slide,
        ctx,
        spec,
        palette,
        cards[index].id,
        704,
        yStart + index * (cardH + gap),
        500,
        cardH,
        cards[index].label,
      );
    }
  } else if (slideDef.figures?.length) {
    await addFigure(slide, ctx, spec, palette, slideDef.figures[0], 704, 166, 500, 410);
    if (slideDef.callouts?.length) {
      await addCalloutRail(slide, ctx, spec, palette, slideDef.callouts, 704, 594, 500, {
        height: 54,
        size: 22,
        maxItems: 1,
      });
    }
  } else if (slideDef.callouts?.length) {
    await addCalloutRail(slide, ctx, spec, palette, slideDef.callouts, 760, 170, 420, {
      gap: 132,
      height: 116,
      size: 26,
      maxItems: 3,
    });
  }
}

async function buildLossTree(slide, ctx, spec, slideDef, palette) {
  addTitle(slide, ctx, palette, slideDef, 1080);
  if (slideDef.body?.length) {
    await richText(slide, ctx, spec, palette, slideDef.body[0], 66, 158, 560, 66, {
      size: 27,
      color: palette.muted,
      valign: "middle",
    });
  }

  const root = { x: 76, y: 224, width: 476, height: 56 };
  rule(slide, ctx, palette, root.x, root.y + root.height, root.width, 2, palette.rule);
  await richText(slide, ctx, spec, palette, slideDef.subtitle || "Total relaxation loss", root.x, root.y + 10, root.width, root.height - 20, {
    size: 25,
    bold: true,
    valign: "middle",
  });

  if (slideDef.columns?.length) {
    const reserveSymbolKey = Boolean(slideDef.symbol_key?.length);
    rule(slide, ctx, palette, root.x + 40, root.y + root.height, 2, reserveSymbolKey ? 338 : 376, palette.rule);
    const categoryBoxes = reserveSymbolKey
      ? [
          { x: 112, y: 294, width: 440, height: 126, accent: palette.accent },
          { x: 112, y: 438, width: 440, height: 102, accent: palette.green },
          { x: 112, y: 552, width: 440, height: 64, accent: palette.amber },
        ]
      : [
          { x: 112, y: 304, width: 440, height: 142, accent: palette.accent },
          { x: 112, y: 466, width: 440, height: 118, accent: palette.green },
          { x: 112, y: 592, width: 440, height: 76, accent: palette.amber },
        ];
    for (let index = 0; index < Math.min(slideDef.columns.length, 3); index += 1) {
      const column = slideDef.columns[index];
      const card = categoryBoxes[index];
      rule(slide, ctx, palette, root.x + 40, card.y + 24, card.x - root.x - 40, 2, palette.rule);
      rule(slide, ctx, palette, card.x + 18, card.y + 16, 4, Math.max(24, card.height - 32), card.accent);
      await richText(slide, ctx, spec, palette, column.title || "", card.x + 38, card.y + 10, card.width - 58, 26, {
        size: 20,
        bold: true,
        valign: "middle",
      });
      const entries = column.bullets?.length ? column.bullets : column.body || [];
      for (let itemIndex = 0; itemIndex < Math.min(entries.length, 3); itemIndex += 1) {
        const item = entries[itemIndex];
        const yy = card.y + 42 + itemIndex * 26;
        const highlight = containsFormula(item, "symbol.gamma.xy");
        if (highlight) {
          rule(slide, ctx, palette, card.x + 38, yy + 22, card.width - 84, 2, palette.accent);
        }
        ctx.addShape(slide, {
          x: card.x + 46,
          y: yy + 6,
          width: 7,
          height: 7,
          geometry: "rect",
          fill: highlight ? palette.accent : card.accent,
          line: ctx.line(),
        });
        await richText(slide, ctx, spec, palette, item, card.x + 62, yy - 4, card.width - 90, 24, {
          size: highlight ? 17 : 16,
          bold: highlight,
          valign: "middle",
          symbolScale: 1.0,
        });
      }
    }
  } else {
    rule(slide, ctx, palette, root.x + 40, root.y + root.height, 2, 214, palette.rule);
    const channels = slideDef.callouts || [];
    for (let index = 0; index < Math.min(channels.length, 4); index += 1) {
      const y = 394 + index * 56;
      const highlight = index === channels.length - 1;
      rule(slide, ctx, palette, root.x + 40, y + 24, 28, 2, palette.rule);
      if (highlight) {
        rule(slide, ctx, palette, root.x + 68, y + 44, 420, 2, palette.accent);
      }
      await richText(slide, ctx, spec, palette, channels[index], root.x + 88, y + 8, 380, 32, {
        size: highlight ? 21 : 20,
        bold: highlight,
        valign: "middle",
      });
    }
  }

  const cards = (slideDef.equations || []).slice(0, 4);
  const cardX = 704;
  const reserveSymbolKey = Boolean(slideDef.symbol_key?.length);
  const cardY = 154;
  const cardW = 500;
  const cardH = reserveSymbolKey ? 106 : 118;
  for (let index = 0; index < cards.length; index += 1) {
    await addEquationCard(
      slide,
      ctx,
      spec,
      palette,
      cards[index].id,
      cardX,
      cardY + index * (cardH + 8),
      cardW,
      cardH,
      cards[index].label,
    );
  }
}

async function buildCircuitQuestion(slide, ctx, spec, slideDef, palette) {
  addTitle(slide, ctx, palette, slideDef, 1100);
  if (slideDef.body?.length) {
    await richText(slide, ctx, spec, palette, slideDef.body[0], 66, 154, 1080, 48, {
      size: 25,
      color: palette.muted,
      valign: "middle",
    });
  }

  const panelSpecs = [
    { x: 66, y: 214, width: 548, height: 282, figure: slideDef.figures?.[0], fallback: true },
    { x: 646, y: 214, width: 548, height: 282, figure: slideDef.figures?.[1], fallback: false },
  ];
  for (const panel of panelSpecs) {
    rule(slide, ctx, palette, panel.x, panel.y, panel.width, 1, palette.rule);
    await richText(slide, ctx, spec, palette, panel.figure?.caption || "", panel.x + 28, panel.y + 20, panel.width - 56, 30, {
      size: 21,
      bold: true,
      color: palette.muted,
      valign: "middle",
      align: "center",
    });
    const asset = panel.figure ? spec.assets?.[panel.figure.asset] : undefined;
    if (asset?.resolved_path) {
      await ctx.addImage(slide, {
        path: asset.resolved_path,
        x: panel.x + 28,
        y: panel.y + 58,
        width: panel.width - 56,
        height: panel.height - 82,
        fit: "contain",
        alt: asset.alt,
      });
    } else if (panel.fallback) {
      await drawGroundedReferenceCircuit(slide, ctx, spec, palette, panel.x + 32, panel.y + 60);
    }
  }

  const cards = [
    {
      equation: slideDef.equations?.[0],
      text: slideDef.bullets?.[0],
      x: 66,
      y: 512,
      accent: palette.accent,
    },
    {
      equation: slideDef.equations?.[1],
      text: slideDef.bullets?.[1],
      x: 646,
      y: 512,
      accent: palette.red,
    },
  ];
  for (const card of cards) {
    rule(slide, ctx, palette, card.x + 22, card.y + 15, 5, 52, card.accent);
    if (card.equation) {
      const asset = spec.equation_assets?.[card.equation.id];
      const dimensions = equationDimensions(asset, EQUATION_CARD_PT_SCALE);
      const equationArea = { x: card.x + 190, y: card.y + 2, width: 330, height: 74 };
      await addEquationImage(
        slide,
        ctx,
        spec,
        card.equation.id,
        equationArea.x + (equationArea.width - dimensions.width) / 2,
        equationArea.y + (equationArea.height - dimensions.height) / 2,
      );
      if (card.equation.label) {
        await richText(slide, ctx, spec, palette, card.equation.label, card.x + 46, card.y + 10, 130, 22, {
          size: 16,
          bold: true,
          color: palette.muted,
          valign: "middle",
        });
      }
    }
    if (card.text) {
      await richText(slide, ctx, spec, palette, card.text, card.x + 46, card.y + 46, 474, 40, {
        size: 18,
        color: palette.text,
        valign: "middle",
        symbolScale: 1.35,
      });
    }
  }

  if (slideDef.callouts?.length) {
    const reserveSymbolKey = Boolean(slideDef.symbol_key?.length);
    const calloutRuleY = reserveSymbolKey ? 566 : 602;
    const calloutTextY = reserveSymbolKey ? 575 : 611;
    rule(slide, ctx, palette, 84, calloutRuleY, 1092, 2, palette.accent);
    await richText(slide, ctx, spec, palette, slideDef.callouts[0], 112, calloutTextY, 1036, 42, {
      size: 24,
      bold: true,
      color: palette.text,
      valign: "middle",
      align: "center",
      symbolScale: 1.8,
    });
  }
}

async function drawGroundedReferenceCircuit(slide, ctx, spec, palette, x, y) {
  const wire = palette.text;
  const selfColor = palette.accent;
  const couplingColor = palette.red;
  const qx = x + 180;
  const qy = y + 96;
  const xyx = x + 388;
  const xyy = qy;

  nodeDot(slide, ctx, palette, qx, qy);
  await addEquationImage(slide, ctx, spec, "grounded.node.q", qx - 11, qy - 42, undefined, undefined, {
    scale: 1.65,
  });

  nodeDot(slide, ctx, palette, xyx, xyy);
  await addEquationImage(slide, ctx, spec, "grounded.node.x", xyx - 7, xyy - 42, undefined, undefined, {
    scale: 1.65,
  });
  rule(slide, ctx, palette, xyx + 5, xyy, 74, 3, wire);
  nodeDot(slide, ctx, palette, xyx + 90, xyy, { size: 9, fill: palette.surface, stroke: wire, strokeWidth: 2 });
  await addEquationImage(slide, ctx, spec, "grounded.port.xy", xyx + 104, xyy - 15, undefined, undefined, {
    scale: 1.35,
  });

  verticalCapacitor(slide, ctx, palette, qx - 72, qy + 78, { color: selfColor, plateWidth: 52 });
  rule(slide, ctx, palette, qx - 72, qy, 72, 3, wire);
  groundSymbol(slide, ctx, palette, qx - 72, qy + 154, wire);
  await addEquationImage(slide, ctx, spec, "grounded.cap.self", qx - 150, qy + 42, undefined, undefined, {
    scale: 2.1,
  });

  rule(slide, ctx, palette, qx, qy, 86, 3, wire);
  horizontalCapacitor(slide, ctx, palette, qx + 160, qy, { color: couplingColor });
  rule(slide, ctx, palette, qx + 178, qy, xyx - qx - 178, 3, wire);
  await addEquationImage(slide, ctx, spec, "grounded.cap.xy", qx + 126, qy - 78, undefined, undefined, {
    scale: 2.1,
  });

  rule(slide, ctx, palette, qx + 56, qy, 3, 64, wire);
  box(slide, ctx, palette, qx + 38, qy + 64, 38, 54, { geometry: "rect", fill: "#F7FAFC", stroke: wire });
  rule(slide, ctx, palette, qx + 56, qy + 118, 3, 44, wire);
  groundSymbol(slide, ctx, palette, qx + 56, qy + 162, wire);
  await addEquationImage(slide, ctx, spec, "grounded.inductor", qx + 84, qy + 70, undefined, undefined, {
    scale: 1.35,
  });

  rule(slide, ctx, palette, xyx, xyy, 3, 64, wire);
  box(slide, ctx, palette, xyx - 22, xyy + 64, 46, 72, { geometry: "rect", fill: "#FFF5F5", stroke: couplingColor, strokeWidth: 1.3 });
  rule(slide, ctx, palette, xyx, xyy + 136, 3, 42, wire);
  groundSymbol(slide, ctx, palette, xyx, xyy + 178, wire);
  await addEquationImage(slide, ctx, spec, "grounded.r50", xyx + 36, xyy + 82, undefined, undefined, {
    scale: 1.35,
  });
}

function containsFormula(value, formulaId) {
  return Boolean(value && Array.isArray(value.parts) && value.parts.some((part) => part.formula === formulaId));
}

async function buildWorkflow(slide, ctx, spec, slideDef, palette) {
  addTitle(slide, ctx, palette, slideDef, 1080);
  if (slideDef.body?.length) {
    await richText(slide, ctx, spec, palette, slideDef.body[0], 70, 154, 980, 72, {
      size: 27,
      color: palette.muted,
      valign: "middle",
    });
  }
  const steps = slideDef.steps || [];
  const x0 = 72;
  const y0 = 238;
  const gap = 16;
  const cols = steps.length <= 4 ? 2 : 3;
  const cardW = (1080 - gap * (cols - 1)) / cols;
  const cardH = 162;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const row = Math.floor(index / cols);
    const col = index % cols;
    const x = x0 + col * (cardW + gap);
    const y = y0 + row * (cardH + gap);
    rule(slide, ctx, palette, x, y, cardW, 1, palette.rule);
    text(slide, ctx, palette, String(index + 1).padStart(2, "0"), x + 24, y + 16, 58, 28, {
      size: 21,
      color: palette.accent,
      bold: true,
    });
    await richText(slide, ctx, spec, palette, step.label, x + 24, y + 48, cardW - 48, 56, {
      size: 25,
      bold: true,
      valign: "middle",
    });
    if (step.detail) {
      await richText(slide, ctx, spec, palette, step.detail, x + 24, y + 112, cardW - 48, 34, {
        size: 20,
        color: palette.muted,
        valign: "middle",
      });
    }
  }
  if (slideDef.callouts?.length) {
    const rows = Math.ceil(steps.length / cols);
    const calloutY = y0 + rows * (cardH + gap) - gap + 12;
    await addCalloutRail(slide, ctx, spec, palette, slideDef.callouts, 78, calloutY, 1060, {
      height: 86,
      gap: 82,
      maxItems: 1,
      size: 27,
    });
  }
}

async function buildRouteWorkflow(slide, ctx, spec, slideDef, palette) {
  addTitle(slide, ctx, palette, slideDef, 1080);
  if (slideDef.body?.length) {
    await richText(slide, ctx, spec, palette, slideDef.body[0], 70, 152, 980, 68, {
      size: 27,
      color: palette.muted,
      valign: "middle",
    });
  }

  const columns = slideDef.columns || [];
  const routeCards = [
    { x: 72, y: 220, width: 520, height: 314, accent: palette.accent },
    { x: 668, y: 220, width: 520, height: 314, accent: palette.red },
  ];
  for (let index = 0; index < Math.min(columns.length, 2); index += 1) {
    const column = columns[index];
    const card = routeCards[index];
    rule(slide, ctx, palette, card.x, card.y, card.width, 1, palette.rule);
    rule(slide, ctx, palette, card.x + 24, card.y + 28, 5, 62, card.accent);
    await richText(slide, ctx, spec, palette, column.title || "", card.x + 48, card.y + 24, card.width - 76, 38, {
      size: 30,
      bold: true,
      valign: "middle",
    });
    const entries = column.bullets?.length ? column.bullets : column.body || [];
    await addBullets(slide, ctx, spec, palette, entries, card.x + 48, card.y + 86, card.width - 76, {
      size: 22,
      lineHeight: 54,
      maxItems: 4,
      dotColor: card.accent,
      symbolScale: 1.35,
    });
  }

  if (slideDef.equations?.[0]) {
    const reserveSymbolKey = Boolean(slideDef.symbol_key?.length);
    await addEquationCard(
      slide,
      ctx,
      spec,
      palette,
      slideDef.equations[0].id,
      220,
      reserveSymbolKey ? 526 : 542,
      780,
      reserveSymbolKey ? 96 : 118,
      undefined,
    );
  }
  if (slideDef.callouts?.length) {
    const reserveSymbolKey = Boolean(slideDef.symbol_key?.length);
    await richText(slide, ctx, spec, palette, slideDef.callouts[0], 1018, reserveSymbolKey ? 532 : 552, 174, reserveSymbolKey ? 70 : 88, {
      size: 18,
      color: palette.muted,
      valign: "middle",
    });
  }
}

async function buildDerivationStack(slide, ctx, spec, slideDef, palette) {
  addTitle(slide, ctx, palette, slideDef, 1100);
  if (slideDef.body?.length) {
    await richText(slide, ctx, spec, palette, slideDef.body[0], 66, 144, 1080, 56, {
      size: 26,
      color: palette.muted,
      valign: "middle",
    });
  }

  const equations = slideDef.equations || [];
  if (equations.length <= 2) {
    if (equations[0]) {
      await addEquationCard(slide, ctx, spec, palette, equations[0].id, 88, 216, 1040, 126, equations[0].label);
    }
    if (equations[1]) {
      await addEquationCard(slide, ctx, spec, palette, equations[1].id, 88, 372, 1040, 232, equations[1].label);
    }
  } else if (equations.length === 3) {
    await addEquationCard(slide, ctx, spec, palette, equations[0].id, 72, 188, 510, 122, equations[0].label);
    await addEquationCard(slide, ctx, spec, palette, equations[1].id, 640, 188, 520, 122, equations[1].label);
    await addEquationCard(slide, ctx, spec, palette, equations[2].id, 72, 342, 1088, 248, equations[2].label);
  } else {
    await addEquationCard(slide, ctx, spec, palette, equations[0].id, 72, 164, 510, 112, equations[0].label);
    await addEquationCard(slide, ctx, spec, palette, equations[1].id, 640, 164, 520, 112, equations[1].label);
    const reserveSymbolKey = Boolean(slideDef.symbol_key?.length);
    await addEquationCard(slide, ctx, spec, palette, equations[2].id, 72, 304, 1088, reserveSymbolKey ? 176 : 188, equations[2].label);
    await addEquationCard(slide, ctx, spec, palette, equations[3].id, 72, reserveSymbolKey ? 502 : 518, 1088, reserveSymbolKey ? 106 : 118, equations[3].label);
  }

  if (slideDef.callouts?.length) {
    await richText(slide, ctx, spec, palette, slideDef.callouts[0], 92, 616, 1030, 42, {
      size: 21,
      bold: true,
      color: palette.text,
      valign: "middle",
      align: "center",
      symbolScale: 1.5,
    });
  }
}

async function buildComparison(slide, ctx, spec, slideDef, palette) {
  addTitle(slide, ctx, palette, slideDef, 1080);
  const columns = slideDef.columns || [];
  const leftX = 78;
  const colY = 236;
  const colW = 510;
  const visibleColumns = columns.slice(0, 2);
  for (let index = 0; index < visibleColumns.length; index += 1) {
    const column = visibleColumns[index];
    const x = leftX + index * 570;
    rule(slide, ctx, palette, x, colY, colW, 1, palette.rule);
    await richText(slide, ctx, spec, palette, column.title || "", x + 28, colY + 26, colW - 56, 44, {
      size: 32,
      bold: true,
      valign: "middle",
    });
    await addBullets(slide, ctx, spec, palette, column.bullets?.length ? column.bullets : column.body || [], x + 30, colY + 96, colW - 60, {
      size: 25,
      lineHeight: 64,
      maxItems: 3,
      dotColor: index === 0 ? palette.accent : palette.red,
    });
  }
  if (slideDef.callouts?.length) {
    rule(slide, ctx, palette, 138, 602, 112, 4, palette.accent);
    await richText(slide, ctx, spec, palette, slideDef.callouts[0], 272, 578, 820, 62, {
      size: 28,
      color: palette.text,
      bold: true,
      valign: "middle",
    });
  }
}

async function buildFigure(slide, ctx, spec, slideDef, palette) {
  addTitle(slide, ctx, palette, slideDef, 1080);
  const figure = slideDef.figures?.[0];
  const assetRole = figure ? spec.assets?.[figure.asset]?.role : undefined;
  const isLayoutFigure = assetRole === "layout";
  const figureBox = isLayoutFigure
    ? { x: 62, y: 170, width: 560, height: 390 }
    : { x: 62, y: 164, width: 650, height: 434 };
  const rail = isLayoutFigure
    ? { x: 670, y: 170, width: 500 }
    : { x: 760, y: 164, width: 400 };
  await addFigure(slide, ctx, spec, palette, figure, figureBox.x, figureBox.y, figureBox.width, figureBox.height);
  if (slideDef.metrics?.length) {
    await addMetricRail(slide, ctx, spec, palette, slideDef.metrics, rail.x, rail.y, rail.width);
  } else if (slideDef.equations?.length) {
    const hasSecondEquation = Boolean(slideDef.equations[1]);
    const firstCardH = hasSecondEquation ? 156 : 186;
    const secondCardH = 142;
    await addEquationCard(slide, ctx, spec, palette, slideDef.equations[0].id, rail.x, rail.y, rail.width, firstCardH, slideDef.equations[0].label);
    if (slideDef.equations[1]) {
      await addEquationCard(slide, ctx, spec, palette, slideDef.equations[1].id, rail.x, rail.y + firstCardH + 20, rail.width, secondCardH, slideDef.equations[1].label);
    }
    if (slideDef.callouts?.length) {
      await addCalloutRail(slide, ctx, spec, palette, slideDef.callouts, rail.x, rail.y + (hasSecondEquation ? firstCardH + secondCardH + 30 : firstCardH + 24), rail.width, {
        height: hasSecondEquation ? 88 : 114,
        gap: hasSecondEquation ? 106 : 116,
        size: isLayoutFigure ? 28 : 22,
        maxItems: hasSecondEquation ? 1 : 2,
      });
    }
  } else if (slideDef.callouts?.length) {
    const reserveSymbolKey = Boolean(slideDef.symbol_key?.length);
    await addCalloutRail(slide, ctx, spec, palette, slideDef.callouts, rail.x, rail.y, rail.width, {
      height: reserveSymbolKey ? 88 : 112,
      gap: reserveSymbolKey ? 104 : 126,
      size: 28,
    });
  }
}

async function buildTwoFigures(slide, ctx, spec, slideDef, palette) {
  addTitle(slide, ctx, palette, slideDef, 850);
  const figures = slideDef.figures || [];
  await addFigure(slide, ctx, spec, palette, figures[0], 70, 156, 525, 392);
  await addFigure(slide, ctx, spec, palette, figures[1], 625, 156, 525, 392);
  if (slideDef.callouts?.length) {
    await richText(slide, ctx, spec, palette, slideDef.callouts[0], 78, 574, 1060, 34, {
      size: 18,
      bold: true,
      color: palette.text,
      valign: "middle",
    });
  }
}

async function buildEvidencePair(slide, ctx, spec, slideDef, palette) {
  addTitle(slide, ctx, palette, slideDef, 1080);
  const figures = slideDef.figures || [];
  const equations = slideDef.equations || [];
  const left = { x: 66, y: 160, width: 540, height: 316 };
  const right = { x: 674, y: 160, width: 540, height: 316 };
  const eqY = 496;
  const eqH = 130;
  await addFigure(slide, ctx, spec, palette, figures[0], left.x, left.y, left.width, left.height);
  await addFigure(slide, ctx, spec, palette, figures[1], right.x, right.y, right.width, right.height);
  if (equations[0]) {
    await addEquationCard(slide, ctx, spec, palette, equations[0].id, left.x, eqY + (equations[0].y_offset || 0), left.width, eqH, equations[0].label);
  }
  if (equations[1]) {
    await addEquationCard(slide, ctx, spec, palette, equations[1].id, right.x, eqY + (equations[1].y_offset || 0), right.width, eqH, equations[1].label);
  }
}

async function buildResultFocus(slide, ctx, spec, slideDef, palette) {
  addTitle(slide, ctx, palette, slideDef, 1080);
  const hasTopSymbolKey = slideDef.symbol_key_position === "top";
  const figure = slideDef.figures?.[0];
  const equations = slideDef.equations || [];
  const figureBox = { x: 58, y: hasTopSymbolKey ? 178 : 150, width: 740, height: 430 };
  const rail = { x: 840, y: hasTopSymbolKey ? 178 : 150, width: 350 };
  await addFigure(slide, ctx, spec, palette, figure, figureBox.x, figureBox.y, figureBox.width, figureBox.height);

  let cursorY = rail.y;
  for (let index = 0; index < Math.min(2, equations.length); index += 1) {
    const equation = equations[index];
    const cardH = equations.length > 1 ? (index === 0 ? 128 : 154) : 164;
    await addEquationCard(
      slide,
      ctx,
      spec,
      palette,
      equation.id,
      rail.x,
      cursorY + (equation.y_offset || 0),
      rail.width,
      cardH,
      equation.label,
    );
    cursorY += cardH + 18;
  }

  const callouts = slideDef.callouts || [];
  if (callouts.length) {
    await addCalloutRail(slide, ctx, spec, palette, callouts, rail.x, cursorY + 4, rail.width, {
      height: 60,
      gap: 70,
      size: 17,
      maxItems: Math.min(4, callouts.length),
    });
  }
}

async function buildTableSlide(slide, ctx, spec, slideDef, palette) {
  addTitle(slide, ctx, palette, slideDef, 850);
  if (slideDef.table) {
    await drawTable(slide, ctx, spec, palette, slideDef.table, 72, 202, 770, 344);
  }
  if (slideDef.equations?.length) {
    await addEquationCard(slide, ctx, spec, palette, slideDef.equations[0].id, 888, 220, 282, 156, slideDef.equations[0].label);
  }
  if (slideDef.callouts?.length) {
    await addCalloutRail(slide, ctx, spec, palette, slideDef.callouts, 888, 410, 282, {
      height: 76,
      gap: 92,
      size: 13,
    });
  }
}

async function drawTable(slide, ctx, spec, palette, table, x, y, width, height) {
  const cols = table.headers.length;
  const rows = table.rows.length + 1;
  const rowH = height / rows;
  const colW = width / cols;
  const formulaColumns = new Set(table.formula_columns || []);
  rule(slide, ctx, palette, x, y, width, 2, palette.rule);
  for (let col = 0; col < table.headers.length; col += 1) {
    const header = table.headers[col];
    text(slide, ctx, palette, header, x + col * colW + 12, y + 12, colW - 24, rowH - 18, {
      size: 11,
      bold: true,
      color: palette.muted,
      align: formulaColumns.has(header) ? "center" : "left",
      valign: "middle",
    });
  }
  rule(slide, ctx, palette, x + 12, y + rowH, width - 24, 1, palette.rule);
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    const row = table.rows[rowIndex];
    const yy = y + rowH * (rowIndex + 1);
    for (let col = 0; col < row.length; col += 1) {
      const cell = row[col];
      const isFormulaColumn = formulaColumns.has(table.headers[col]);
      await richText(slide, ctx, spec, palette, cell, x + col * colW + 12, yy + 6, colW - 24, rowH - 18, {
        size: 12,
        color: col === 0 ? palette.text : palette.muted,
        bold: col === 0,
        align: isFormulaColumn ? "center" : "left",
        valign: "middle",
        symbolScale: isFormulaColumn ? 0.95 : 1.0,
      });
    }
    if (rowIndex < table.rows.length - 1) {
      rule(slide, ctx, palette, x + 12, yy + rowH, width - 24, 1, palette.rule);
    }
  }
  if (table.source) {
    text(slide, ctx, palette, table.source, x + 4, y + height + 12, width, 18, {
      size: 9,
      color: palette.muted,
    });
  }
}

async function buildAppendixIndex(slide, ctx, _spec, slideDef, palette) {
  addTitle(slide, ctx, palette, slideDef, 920);
  const items = slideDef.bullets || [];
  const x = 112;
  const y = 190;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const col = index >= 4 ? 1 : 0;
    const row = index % 4;
    const xx = x + col * 535;
    const yy = y + row * 92;
    rule(slide, ctx, palette, xx, yy, 470, 1, palette.rule);
    text(slide, ctx, palette, `A${index + 1}`, xx + 18, yy + 18, 48, 24, {
      size: 14,
      color: palette.accent,
      bold: true,
    });
    await richText(slide, ctx, _spec, palette, item, xx + 74, yy + 14, 360, 36, {
      size: 17,
      bold: true,
      valign: "middle",
    });
  }
}

async function buildReferences(slide, ctx, spec, slideDef, palette) {
  addTitle(slide, ctx, palette, slideDef, 920);
  await addBullets(slide, ctx, spec, palette, slideDef.bullets || [], 80, 206, 1040, {
    size: 15,
    lineHeight: 58,
    maxItems: 8,
  });
}
