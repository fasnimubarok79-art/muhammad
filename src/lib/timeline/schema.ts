import { z } from "zod";

/**
 * The timeline document shared by the Studio, the save API and the render worker.
 * All times are integer frames at `fps`, so split, trim and seek never accumulate float error.
 * Subtitles and word cards are not stored here: they stay in SubtitleSegment and Clip.editConfig.cards
 * and are anchored to the source speech; the SUBTITLE and CARDS tracks only hold lock/hide state.
 */
export const TRACK_TYPES = ["VIDEO", "AUDIO", "SUBTITLE", "TEXT", "OVERLAY", "BROLL", "EFFECTS", "CARDS"] as const;
export type TrackType = (typeof TRACK_TYPES)[number];
export const ITEM_KINDS = ["video", "audio", "image", "text", "effect"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const KF_PROPS = ["x", "y", "scale", "opacity", "volume"] as const;
export type KfProp = (typeof KF_PROPS)[number];
export const EFFECT_TYPES = ["zoom", "flash", "bw", "blur"] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];
export const FPS_CHOICES = [24, 25, 30, 60] as const;

/** Which item kinds a track accepts. Subtitle and card tracks draw existing data and hold no items. */
export const TRACK_ACCEPTS: Record<TrackType, readonly ItemKind[]> = {
  VIDEO: ["video", "image"],
  BROLL: ["video", "image"],
  OVERLAY: ["video", "image"],
  AUDIO: ["audio"],
  TEXT: ["text"],
  EFFECTS: ["effect"],
  SUBTITLE: [],
  CARDS: [],
};
export const VISUAL_TRACKS: readonly TrackType[] = ["VIDEO", "BROLL", "OVERLAY"];

const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const MAX_FRAMES = 60 * 60 * 60 * 4; // 4 hours at 60 fps

export const keyframeSchema = z.object({
  prop: z.enum(KF_PROPS),
  frame: z.number().int().min(0).max(MAX_FRAMES), // item-local frame
  value: z.number().min(-10).max(10),
  ease: z.enum(["linear", "ease"]),
});
export type Keyframe = z.infer<typeof keyframeSchema>;

export const transformSchema = z.object({
  x: z.number().min(-1).max(2), // centre, share of the frame width
  y: z.number().min(-1).max(2),
  scale: z.number().min(0.05).max(5), // 1 = fit the frame (contain) or fill it (cover)
  rotation: z.number().min(-360).max(360),
  fit: z.enum(["contain", "cover"]),
  crop: z.object({ l: z.number().min(0).max(0.45), t: z.number().min(0).max(0.45), r: z.number().min(0).max(0.45), b: z.number().min(0).max(0.45) }),
});
export type Transform = z.infer<typeof transformSchema>;

export const effectsSchema = z.object({
  fadeIn: z.number().int().min(0).max(600), // frames, audio fade
  fadeOut: z.number().int().min(0).max(600),
  type: z.enum(EFFECT_TYPES).optional(), // effect items only
  intensity: z.number().min(0).max(1).optional(),
});
export type Effects = z.infer<typeof effectsSchema>;

export const textSchema = z.object({
  text: z.string().trim().min(1).max(120),
  font: z.enum(["sans", "serif"]),
  size: z.number().int().min(30).max(300), // px at a 1920px-tall frame
  color: hex,
  outline: z.number().min(0).max(12),
  anim: z.enum(["fade", "pop", "cut"]),
});
export type TextConfig = z.infer<typeof textSchema>;

export const itemSchema = z.object({
  id,
  trackId: id,
  kind: z.enum(ITEM_KINDS),
  mediaAssetId: id.nullable(),
  sourceVideoId: id.nullable(),
  startFrame: z.number().int().min(0).max(MAX_FRAMES),
  durationFrames: z.number().int().min(1).max(MAX_FRAMES),
  sourceInFrame: z.number().int().min(0).max(MAX_FRAMES),
  speed: z.number().min(0.25).max(4),
  opacity: z.number().min(0).max(1),
  volume: z.number().min(0).max(2),
  transform: transformSchema.nullable(),
  effects: effectsSchema.nullable(),
  keyframes: z.array(keyframeSchema).max(200),
  text: textSchema.nullable(),
});
export type Item = z.infer<typeof itemSchema>;

export const trackSchema = z.object({
  id,
  name: z.string().trim().min(1).max(40),
  type: z.enum(TRACK_TYPES),
  order: z.number().int().min(0).max(1000),
  hidden: z.boolean(),
  muted: z.boolean(),
  locked: z.boolean(),
  volume: z.number().min(0).max(2),
});
export type Track = z.infer<typeof trackSchema>;

export const markerSchema = z.object({ id, frame: z.number().int().min(0).max(MAX_FRAMES), label: z.string().max(60), color: hex });
export type Marker = z.infer<typeof markerSchema>;

export const timelineSchema = z
  .object({
    id,
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]),
    width: z.number().int().min(16).max(7680),
    height: z.number().int().min(16).max(7680),
    playheadFrame: z.number().int().min(0).max(MAX_FRAMES),
    tracks: z.array(trackSchema).min(1).max(30),
    items: z.array(itemSchema).max(2000),
    markers: z.array(markerSchema).max(200),
  })
  .superRefine((doc, ctx) => {
    const tracks = new Map(doc.tracks.map((t) => [t.id, t]));
    if (tracks.size !== doc.tracks.length) ctx.addIssue({ code: "custom", message: "Duplicate track id" });
    if (new Set(doc.items.map((i) => i.id)).size !== doc.items.length) ctx.addIssue({ code: "custom", message: "Duplicate item id" });
    if (!doc.tracks.some((t) => t.type === "VIDEO")) ctx.addIssue({ code: "custom", message: "A timeline needs a video track" });
    for (const it of doc.items) {
      const tr = tracks.get(it.trackId);
      if (!tr) { ctx.addIssue({ code: "custom", message: `Item ${it.id} is on a missing track` }); continue; }
      if (!TRACK_ACCEPTS[tr.type].includes(it.kind)) ctx.addIssue({ code: "custom", message: `A ${tr.type} track cannot hold a ${it.kind} item` });
      const media = it.kind === "video" || it.kind === "audio" || it.kind === "image";
      const refs = Number(it.mediaAssetId !== null) + Number(it.sourceVideoId !== null);
      if (media ? refs !== 1 : refs !== 0) ctx.addIssue({ code: "custom", message: `Item ${it.id} has a wrong media reference` });
      if (it.kind === "text" && !it.text) ctx.addIssue({ code: "custom", message: `Text item ${it.id} has no text` });
      if (it.kind === "effect" && !it.effects?.type) ctx.addIssue({ code: "custom", message: `Effect item ${it.id} has no effect type` });
    }
    // no two items overlap on one track
    for (const tr of doc.tracks) {
      const list = doc.items.filter((i) => i.trackId === tr.id).sort((a, b) => a.startFrame - b.startFrame);
      for (let k = 1; k < list.length; k++) {
        if (list[k].startFrame < list[k - 1].startFrame + list[k - 1].durationFrames) ctx.addIssue({ code: "custom", message: `Items overlap on track ${tr.name}` });
      }
    }
  });
export type TimelineDoc = z.infer<typeof timelineSchema>;

/** Media facts the editor and the renderer need about an item's file. */
export type MediaInfo = {
  ref: string; // "asset:<id>" or "source:<id>"
  kind: "VIDEO" | "AUDIO" | "IMAGE";
  name: string;
  durationSec: number | null; // null for images
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  url: string;
  thumbUrl: string | null;
};
export const mediaRef = (it: Pick<Item, "mediaAssetId" | "sourceVideoId">) => (it.mediaAssetId ? `asset:${it.mediaAssetId}` : it.sourceVideoId ? `source:${it.sourceVideoId}` : "");
