/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { logger } from "./types";

// Bump this on every build so the log lines can be told apart.
export const LOG_VERSION = "v5";

const Native = IS_WEB
    ? null
    : (VencordNative.pluginHelpers.BigFileUpload as PluginNative<typeof import("./native")> | undefined) ?? null;

function stamp(): string {
    const d = new Date();
    const two = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

function write(body: string): void {
    const line = `[${LOG_VERSION} ${stamp()}] ${body}`;
    logger.info(line);
    try {
        void Native?.appendLog(line);
    } catch { }
}

/** Writes a line tagged with the part of the plugin that produced it. */
export function trace(scope: string, text: string): void {
    write(`[${scope}] ${text}`);
}
