import { colors, compactNumber, gradients, identityFor } from "@rpgllm/shared";
import { clamp01, easeInOut, easeOut, easeOutBack, lerp, withAlpha } from "./math";
import { measure } from "./text";
import {
  CARD_PAD,
  COL_W,
  PAD,
  STAGE,
  type Align,
  type PostPanel,
  type ReelNode,
  type ReelPlan,
  type Wrapped,
} from "./scene";

/**
 * The reel, frame by frame: `frameAt(plan, t)` is the only thing a painter calls, and it is pure —
 * same plan and same `t`, same list of primitives, on every device and inside the recorder.
 */

/* ----------------------------------------------------------------- xforms -- */

interface Xform {
  tx: number;
  ty: number;
  scale: number;
  ox: number;
  oy: number;
  alpha: number;
}

function place(v: number, origin: number, scale: number, translate: number): number {
  return origin + (v - origin) * scale + translate;
}

/** Bakes a group transform into absolute coordinates — the flat node list has no group node. */
function xform(nodes: ReelNode[], m: Xform): ReelNode[] {
  const { tx, ty, scale, ox, oy, alpha } = m;
  const sx = (v: number): number => place(v, ox, scale, tx);
  const sy = (v: number): number => place(v, oy, scale, ty);
  return nodes.map((n): ReelNode => {
    switch (n.k) {
      case "rect":
        return {
          ...n,
          x: sx(n.x),
          y: sy(n.y),
          w: n.w * scale,
          h: n.h * scale,
          r: n.r * scale,
          sw: n.sw * scale,
          alpha: n.alpha * alpha,
        };
      case "grad":
        return { ...n, x: sx(n.x), y: sy(n.y), w: n.w * scale, h: n.h * scale, r: n.r * scale, alpha: n.alpha * alpha };
      case "glow":
      case "dot":
        return { ...n, x: sx(n.x), y: sy(n.y), r: n.r * scale, alpha: n.alpha * alpha };
      case "ring":
        return { ...n, x: sx(n.x), y: sy(n.y), r: n.r * scale, sw: n.sw * scale, alpha: n.alpha * alpha };
      case "orb":
        return { ...n, x: sx(n.x), y: sy(n.y), size: n.size * scale, alpha: n.alpha * alpha };
      case "mark":
        return { ...n, x: sx(n.x), y: sy(n.y), size: n.size * scale, alpha: n.alpha * alpha };
      case "text":
        return {
          ...n,
          x: sx(n.x),
          y: sy(n.y),
          w: n.w * scale,
          size: n.size * scale,
          track: n.track * scale,
          alpha: n.alpha * alpha,
        };
      default:
        return n;
    }
  });
}

function textBlock(
  block: Wrapped,
  x: number,
  w: number,
  top: number,
  align: Align,
  color: string,
  alpha: number,
  track = 0,
): ReelNode[] {
  const lead = Math.round(block.size * block.lead);
  return block.lines.map((line, i) => ({
    k: "text",
    x,
    w,
    y: top + lead * i + lead / 2,
    align,
    text: line,
    size: block.size,
    bold: block.bold,
    face: block.face,
    color,
    alpha,
    track,
  }));
}

const blockHeight = (block: Wrapped): number => Math.round(block.size * block.lead) * Math.max(1, block.lines.length);

/* ------------------------------------------------------------------ pieces -- */

function backdrop(plan: ReelPlan, t: number): ReelNode[] {
  const secs = t / 1000;
  const heat = clamp01((t - plan.t.stat) / 900);
  const out: ReelNode[] = [{ k: "fill", color: colors.bg }];
  out.push({
    k: "grad",
    x: 0,
    y: 0,
    w: STAGE.w,
    h: 1180,
    r: 0,
    from: withAlpha(plan.identity.from, 0.34),
    to: withAlpha(colors.bg, 0),
    angle: 158,
    alpha: 1,
  });
  for (const b of plan.bands) {
    out.push({
      k: "grad",
      x: b.x,
      y: 0,
      w: b.w,
      h: STAGE.h,
      r: 0,
      from: withAlpha(colors.text, b.o),
      to: withAlpha(colors.text, 0),
      angle: 180,
      alpha: 0.85,
    });
  }
  for (const s of plan.sparks) {
    const y = (s.y - secs * s.drift) % STAGE.h;
    const tw = plan.quality.twinkle ? 0.62 + 0.38 * Math.sin(secs * 1.7 + s.phase) : 1;
    out.push({ k: "dot", x: s.x, y: y < 0 ? y + STAGE.h : y, r: s.r, color: colors.text, alpha: s.o * tw });
  }
  const tone = plan.winning ? colors.positive : colors.negative;
  out.push({
    k: "glow",
    x: STAGE.w / 2,
    y: STAGE.h + 150,
    r: 900,
    color: tone,
    alpha: 0.2 + heat * 0.4,
  });
  return out;
}

function chrome(plan: ReelPlan, t: number): ReelNode[] {
  const a = easeOut(clamp01(t / 400));
  const p = clamp01(t / plan.durationMs);
  const railW = STAGE.w - PAD * 2;
  return [
    { k: "mark", x: PAD + measure("status", 52, "display", true) / 2, y: 128, size: 52, alpha: a },
    {
      k: "text",
      x: PAD,
      w: railW,
      y: 134,
      align: "right",
      text: plan.reel.worldTitle.toUpperCase(),
      size: 26,
      bold: true,
      face: "text",
      color: colors.textMuted,
      alpha: a,
      track: 3.2,
    },
    {
      k: "rect",
      x: PAD,
      y: 54,
      w: railW,
      h: 7,
      r: 4,
      fill: withAlpha(colors.text, 0.14),
      stroke: null,
      sw: 0,
      alpha: a,
    },
    {
      k: "grad",
      x: PAD,
      y: 54,
      w: Math.max(8, railW * p),
      h: 7,
      r: 4,
      from: plan.identity.from,
      to: plan.identity.to,
      angle: 90,
      alpha: a,
    },
  ];
}

function hero(plan: ReelPlan, t: number): ReelNode[] {
  const inA = easeOut(clamp01((t - plan.t.setup) / 620));
  const outA = 1 - easeInOut(clamp01((t - (plan.t.post - 220)) / 520));
  const alpha = inA * outA;
  if (alpha <= 0.002) return [];
  const rise = (1 - inA) * 70;
  const orb = 300;
  const nodes: ReelNode[] = [
    { k: "orb", x: (STAGE.w - orb) / 2, y: 486 + rise, size: orb, handle: plan.setup.handle, ring: true, alpha },
    {
      k: "text",
      x: PAD,
      w: COL_W,
      y: 892 + rise,
      align: "center",
      text: plan.setup.name,
      size: 74,
      bold: true,
      face: "display",
      color: colors.text,
      alpha,
      track: -1.4,
    },
    {
      k: "text",
      x: PAD,
      w: COL_W,
      y: 972 + rise,
      align: "center",
      text: `@${plan.setup.handle}`,
      size: 36,
      bold: false,
      face: "text",
      color: colors.textDim,
      alpha,
      track: 0,
    },
  ];
  nodes.push(
    ...textBlock(plan.setup.caption, PAD + 20, COL_W - 40, 1056 + rise, "center", colors.textDim, alpha * 0.92),
  );
  return xform(nodes, {
    tx: 0,
    ty: 0,
    scale: lerp(0.92, 1, inA) * lerp(1, 0.9, 1 - outA),
    ox: STAGE.w / 2,
    oy: 800,
    alpha: 1,
  });
}

/**
 * Who this is, held just long enough to be read and then given away.
 *
 * It hands over to the post card's own author row as the column grows: two names on screen at once
 * is one name too many, and the column needs the space it was using.
 */
function identityRow(plan: ReelPlan, t: number): ReelNode[] {
  const handover = plan.replies[plan.replies.length - 1]?.beat.at ?? plan.t.stat;
  const a = easeOut(clamp01((t - (plan.t.post - 120)) / 460)) * (1 - easeInOut(clamp01((t - (handover - 300)) / 460)));
  if (a <= 0.002) return [];
  const y = 244;
  return [
    { k: "orb", x: PAD, y, size: 96, handle: plan.setup.handle, ring: true, alpha: a },
    {
      k: "text",
      x: PAD + 124,
      w: COL_W - 124,
      y: y + 32,
      align: "left",
      text: plan.setup.name,
      size: 40,
      bold: true,
      face: "display",
      color: colors.text,
      alpha: a,
      track: -0.6,
    },
    {
      k: "text",
      x: PAD + 124,
      w: COL_W - 124,
      y: y + 76,
      align: "left",
      text: `@${plan.setup.handle}`,
      size: 30,
      bold: false,
      face: "text",
      color: colors.textMuted,
      alpha: a,
      track: 0,
    },
  ];
}

function panelNodes(
  plan: ReelPlan,
  panel: PostPanel,
  top: number,
  w: number,
  x: number,
  lead: boolean,
  alpha: number,
): ReelNode[] {
  const handle = panel.beat.handle ?? plan.setup.handle;
  const id = identityFor(handle);
  const nodes: ReelNode[] = [
    {
      k: "rect",
      x,
      y: top,
      w,
      h: panel.h,
      r: 40,
      fill: lead ? colors.cardHi : colors.card,
      stroke: lead ? colors.borderHi : colors.border,
      sw: 2,
      alpha,
    },
    { k: "grad", x, y: top, w: 8, h: panel.h, r: 4, from: id.from, to: id.to, angle: 180, alpha },
    { k: "orb", x: x + CARD_PAD, y: top + CARD_PAD, size: lead ? 76 : 62, handle, ring: false, alpha },
    {
      k: "text",
      x: x + CARD_PAD + (lead ? 100 : 84),
      w: w - CARD_PAD * 2 - (lead ? 100 : 84),
      y: top + CARD_PAD + (lead ? 26 : 20),
      align: "left",
      text: panel.beat.displayName ?? handle,
      size: lead ? 36 : 31,
      bold: true,
      face: "text",
      color: colors.text,
      alpha,
      track: 0,
    },
    {
      k: "text",
      x: x + CARD_PAD + (lead ? 100 : 84),
      w: w - CARD_PAD * 2 - (lead ? 100 : 84),
      y: top + CARD_PAD + (lead ? 68 : 56),
      align: "left",
      text: `@${handle}`,
      size: lead ? 28 : 25,
      bold: false,
      face: "text",
      color: colors.textMuted,
      alpha,
      track: 0,
    },
  ];
  nodes.push(
    ...textBlock(panel.body, x + CARD_PAD, w - CARD_PAD * 2, top + CARD_PAD + panel.head, "left", colors.text, alpha),
  );
  return nodes;
}

/** The post and its replies, as one column that later slides up and dims behind the numbers. */
function column(plan: ReelPlan, t: number): ReelNode[] {
  if (!plan.post) return [];
  const nodes: ReelNode[] = [];

  /*
   * The column is centred on what has arrived, not on what will arrive. A post on its own sits in
   * the middle of the frame; as each reply lands the stack grows and slides up to stay centred, so
   * there is never a frame with the composition bunched at the top and half the frame empty — which
   * is exactly the frame a thumbnail would pick.
   */
  const grown = plan.replies.reduce(
    (sum, panel) => sum + (panel.h + 20) * easeOut(clamp01((t - panel.beat.at) / 460)),
    plan.post.h,
  );
  // bottom-anchored: the stack grows upward from a fixed line, the way a thread fills a screen,
  // so the last thing to arrive is always in the same place and the numbers below are never hit
  const top = Math.max(340, Math.min(620, 1390 - (grown + 26)));

  const inP = easeOutBack(clamp01((t - plan.t.post) / 560));
  if (t >= plan.t.post - 40) {
    nodes.push(
      ...xform(panelNodes(plan, plan.post, top, COL_W, PAD, true, clamp01(inP * 1.6)), {
        tx: 0,
        ty: (1 - inP) * 120,
        scale: lerp(0.94, 1, clamp01(inP)),
        ox: STAGE.w / 2,
        oy: top,
        alpha: 1,
      }),
    );
  }

  let y = top + plan.post.h + 26;
  plan.replies.forEach((panel, i) => {
    const at = panel.beat.at;
    if (t < at - 40) {
      y += panel.h + 22;
      return;
    }
    const p = clamp01((t - at) / 460);
    const e = easeOutBack(p);
    // alternating sides: two replies arriving the same way read as one block, not as a conversation
    const from = i % 2 === 0 ? 150 : -150;
    nodes.push(
      ...xform(panelNodes(plan, panel, y, COL_W - 56, PAD + 56, false, clamp01(p * 2)), {
        tx: from * (1 - easeOut(p)),
        ty: (1 - e) * 40,
        scale: lerp(0.9, 1, e),
        ox: STAGE.w / 2,
        oy: y + panel.h / 2,
        alpha: 1,
      }),
    );
    y += panel.h + 20;
  });

  /*
   * When the numbers land the column stays where it is and goes quiet: pushing it up would drive it
   * through the header, and the tiles are opaque, so dimming reads as depth instead of collision.
   */
  const back = easeInOut(clamp01((t - plan.t.stat + 160) / 620));
  const fade = easeInOut(clamp01((t - plan.t.headline) / 420));
  return xform(nodes, {
    tx: 0,
    ty: -back * 40,
    scale: lerp(1, 0.94, back),
    ox: STAGE.w / 2,
    oy: 820,
    alpha: lerp(1, 0.3, back) * (1 - fade),
  });
}

/**
 * The numbers.
 *
 * They arrive empty, with the post, and sit in the bottom third doing nothing — which is the point:
 * a reel that only shows the payoff has no anticipation, and a frame with an empty bottom third has
 * no composition. Then they count. Counting is the whole content of this game; a number that simply
 * appears has thrown the moment away.
 */
function statTiles(plan: ReelPlan, t: number): ReelNode[] {
  const stat = plan.stat;
  if (!stat) return [];
  const armedAt = plan.t.post + 260;
  const enter = easeOut(clamp01((t - armedAt) / 620));
  if (enter <= 0.004) return [];
  const fade = easeInOut(clamp01((t - plan.t.headline) / 380));
  if (fade >= 1) return [];

  const gap = 24;
  const w = Math.round((COL_W - gap * 2) / 3);
  const h = 230;
  const top = 1440;
  const entries: { label: string; value: number }[] = [
    { label: plan.labels.followers, value: stat.delta.followers },
    { label: plan.labels.aura, value: stat.delta.aura },
    { label: plan.labels.humor, value: stat.delta.humor },
  ];

  const nodes: ReelNode[] = [];
  const life = t - stat.at;

  // the hit: one ring pushing out from behind the numbers on the frame they land
  const ringP = clamp01(life / 700);
  if (life >= 0 && ringP < 1) {
    nodes.push({
      k: "ring",
      x: STAGE.w / 2,
      y: top + h / 2,
      r: 120 + easeOut(ringP) * 620,
      color: plan.winning ? colors.positive : colors.negative,
      sw: 12 * (1 - ringP),
      alpha: (1 - ringP) * 0.55 * (1 - fade),
    });
  }

  entries.forEach((entry, i) => {
    const stagger = life - i * 130;
    const live = clamp01(stagger / 260);
    const pop = live > 0 && live < 1 ? 1 + Math.sin(live * Math.PI) * 0.07 : 1;
    const x = PAD + i * (w + gap);
    const tone = entry.value > 0 ? colors.positive : entry.value < 0 ? colors.negative : colors.textMuted;
    const ink = live > 0.5 ? tone : colors.textMuted;
    const counted = Math.round(entry.value * easeOut(clamp01(stagger / 900)));
    const shown = counted > 0 ? `+${compactNumber(counted)}` : compactNumber(counted);
    const alpha = (0.42 + 0.58 * live) * enter * (1 - fade);
    const tile: ReelNode[] = [
      {
        k: "rect",
        x,
        y: top,
        w,
        h,
        r: 30,
        fill: colors.card,
        stroke: live > 0.5 ? withAlpha(tone, 0.55) : colors.border,
        sw: 2,
        alpha,
      },
      { k: "grad", x, y: top, w, h: 6, r: 3, from: withAlpha(ink, 0.9), to: withAlpha(ink, 0), angle: 90, alpha },
      {
        k: "text",
        x,
        w,
        y: top + 50,
        align: "center",
        text: entry.label.toUpperCase(),
        size: 24,
        bold: true,
        face: "text",
        color: colors.textMuted,
        alpha,
        track: 2.6,
      },
      {
        k: "text",
        x,
        w,
        y: top + 146,
        align: "center",
        text: shown,
        size: 76,
        bold: true,
        face: "display",
        color: ink,
        alpha,
        track: -1.6,
      },
    ];
    nodes.push(
      ...xform(tile, {
        tx: 0,
        ty: (1 - enter) * 70,
        scale: lerp(0.9, 1, enter) * pop,
        ox: x + w / 2,
        oy: top + h / 2,
        alpha: 1,
      }),
    );
  });
  return nodes;
}

function headline(plan: ReelPlan, t: number): ReelNode[] {
  const life = t - plan.t.headline;
  if (life < -80) return [];
  const p = clamp01(life / 620);
  // the outro is a *cut*, not a dissolve on top: two full-frame layers at once is a smear
  const out = 1 - easeInOut(clamp01((t - (plan.t.outro - 340)) / 420));
  if (out <= 0.004) return [];
  const e = easeOut(p) * out;
  const tone = plan.winning ? gradients.win : gradients.lose;
  const height = blockHeight(plan.headline);
  const top = Math.round((STAGE.h - height) / 2) - 40;
  const nodes: ReelNode[] = [
    {
      k: "rect",
      x: 0,
      y: 0,
      w: STAGE.w,
      h: STAGE.h,
      r: 0,
      fill: withAlpha(colors.bg, 0.9 * e),
      stroke: null,
      sw: 0,
      alpha: 1,
    },
    {
      k: "grad",
      x: 0,
      y: STAGE.h - 900,
      w: STAGE.w,
      h: 900,
      r: 0,
      from: withAlpha(tone[0], 0),
      to: withAlpha(tone[0], 0.3),
      angle: 180,
      alpha: e,
    },
  ];
  plan.headline.lines.forEach((line, i) => {
    const lp = easeOut(clamp01((life - i * 150) / 560));
    const lead = Math.round(plan.headline.size * plan.headline.lead);
    nodes.push(
      ...xform(
        [
          {
            k: "text",
            x: PAD,
            w: COL_W,
            y: top + lead * i + lead / 2,
            align: "center",
            text: line,
            size: plan.headline.size,
            bold: true,
            face: "display",
            color: colors.text,
            alpha: lp * out,
            track: -2,
          },
        ],
        {
          tx: 0,
          ty: (1 - lp) * 40,
          scale: lerp(1.12, 1, lp),
          ox: STAGE.w / 2,
          oy: top + lead * i + lead / 2,
          alpha: 1,
        },
      ),
    );
  });
  nodes.push({
    k: "grad",
    x: STAGE.w / 2 - 120,
    y: top + height + 60,
    w: 240,
    h: 8,
    r: 4,
    from: tone[0],
    to: tone[1],
    angle: 90,
    alpha: e,
  });
  return nodes;
}

function outro(plan: ReelPlan, t: number): ReelNode[] {
  const life = t - plan.t.outro;
  if (life < -60) return [];
  // the end card gets whatever the server left it, so it lands fast and then simply holds
  const e = easeOut(clamp01(life / 360));
  const nodes: ReelNode[] = [
    {
      k: "rect",
      x: 0,
      y: 0,
      w: STAGE.w,
      h: STAGE.h,
      r: 0,
      fill: withAlpha(colors.bg, 0.92 * e),
      stroke: null,
      sw: 0,
      alpha: 1,
    },
    { k: "orb", x: (STAGE.w - 200) / 2, y: 690, size: 200, handle: plan.outro.handle, ring: true, alpha: e },
    { k: "mark", x: STAGE.w / 2, y: 1010, size: 100, alpha: e },
    {
      k: "text",
      x: PAD,
      w: COL_W,
      y: 1132,
      align: "center",
      text: `@${plan.outro.handle} · ${plan.outro.credit}`,
      size: 34,
      bold: false,
      face: "text",
      color: colors.textDim,
      alpha: e,
      track: 0,
    },
  ];
  return xform(nodes, { tx: 0, ty: (1 - e) * 30, scale: lerp(0.96, 1, e), ox: STAGE.w / 2, oy: 980, alpha: 1 });
}

/* -------------------------------------------------------------------- api -- */

/** The whole frame, in paint order. Pure: same plan and same `t` → same list, always. */
export function frameAt(plan: ReelPlan, tMs: number): ReelNode[] {
  const t = Math.max(0, Math.min(plan.durationMs, tMs));
  // the chrome sits above the headline takeover on purpose: a clip cropped out of this and
  // reposted somewhere else still has to say what app it came from and how much of it is left
  return [
    ...backdrop(plan, t),
    ...hero(plan, t),
    ...identityRow(plan, t),
    ...column(plan, t),
    ...statTiles(plan, t),
    ...headline(plan, t),
    ...chrome(plan, t),
    ...outro(plan, t),
  ];
}
