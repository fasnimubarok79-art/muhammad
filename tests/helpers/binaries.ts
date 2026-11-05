import { spawnSync } from "node:child_process";

/**
 * Test binaries come from the same configuration the app uses. On Windows FFmpeg is often not on
 * PATH (it lives in C:\ffmpeg and is configured through FFMPEG_PATH/FFPROBE_PATH), so hard-coding
 * the command names silently skipped the real render tests.
 */
export const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
export const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
export const hasFfmpeg = spawnSync(FFMPEG, ["-version"], { stdio: "ignore" }).status === 0;
export const hasFfprobe = spawnSync(FFPROBE, ["-version"], { stdio: "ignore" }).status === 0;
