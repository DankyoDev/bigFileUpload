/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findCssClassesLazy } from "@webpack";
import { ChannelStore, DraftType, EditMessageStore, PermissionsBits, PermissionStore, SelectedChannelStore } from "@webpack/common";

import { trace } from "./debugLog";
import { settings } from "./settings";
import { logger, uploadProvidedFiles } from "./utils/upload";

const ChannelTextAreaClasses = findCssClassesLazy("channelTextArea");

// Only images and videos are taken from the clipboard; text and everything else stays with Discord.
const MEDIA_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg|ico|heic|heif|tiff?|mp4|m4v|mov|webm|mkv|avi|mpe?g|ogv)$/i;

function isMediaFile(file: File): boolean {
    return file.type.startsWith("image/") || file.type.startsWith("video/") || MEDIA_EXTENSION.test(file.name);
}

function describeNode(node: EventTarget | Node | null): string {
    if (!(node instanceof HTMLElement)) return String(node);
    const cls = typeof node.className === "string" ? node.className.trim().split(/\s+/)[0] : "";
    return `${node.tagName.toLowerCase()}${cls ? "." + cls : ""}${node.isContentEditable ? "[editable]" : ""}`;
}

function ancestorChain(node: HTMLElement | null): string {
    const parts: string[] = [];
    for (let el = node; el && parts.length < 8; el = el.parentElement) {
        const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
        const role = el.getAttribute("role");
        parts.push(`${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${role ? `[role=${role}]` : ""}`);
    }
    return parts.join(" < ");
}

function closestEditor(target: EventTarget | null): HTMLElement | null {
    let el = target instanceof Element ? target : null;
    for (; el; el = el.parentElement) {
        if (el instanceof HTMLElement && el.isContentEditable) return el;
    }
    return null;
}

function isChatComposer(editor: HTMLElement): boolean {
    const areaClass = ChannelTextAreaClasses?.channelTextArea as string | undefined;
    for (let el: HTMLElement | null = editor; el; el = el.parentElement) {
        if (areaClass && el.classList.contains(areaClass)) return true;
        const cls = typeof el.className === "string" ? el.className : "";
        if (cls.includes("channelTextArea")) return true;
        // Discord's chat composer is a multiline textbox (Slate, usually).
        if (el.getAttribute("role") === "textbox" || el.hasAttribute("data-slate-editor")) return true;
    }
    return false;
}

function collectMediaFiles(data: DataTransfer): File[] {
    const files = Array.from(data.files ?? []).filter(isMediaFile);
    if (files.length) return files;
    for (const item of Array.from(data.items ?? [])) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file && isMediaFile(file)) files.push(file);
    }
    return files;
}

// Channels where Discord can attach the file itself: let it, no need to upload to an external host.
function attachmentDecision(channelId: string): { can: boolean; description: string; } {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return { can: false, description: `channel ${channelId} not found` };
    if (!channel.guild_id) return { can: true, description: "direct message" };
    const can = PermissionStore.can(PermissionsBits.ATTACH_FILES, channel);
    return { can, description: `#${channel.name ?? channelId} (guild ${channel.guild_id}) ATTACH_FILES=${can}` };
}

function onPaste(event: ClipboardEvent): void {
    const data = event.clipboardData;
    if (!data) {
        trace("paste", "event without clipboardData");
        return;
    }

    const items = Array.from(data.items ?? []);
    const files = collectMediaFiles(data);
    if (files.length || data.files.length || items.some(i => i.kind === "file")) {
        trace("paste", `event: files=${data.files.length} media=${files.length} items=[${items.map(i => `${i.kind}:${i.type}`).join(", ")}] target=${describeNode(event.target)}`);
    }

    if (!settings.store.autoUploadPastedFiles) {
        if (files.length) trace("paste", "skipped: 'Bypass Pasted Files' is off");
        return;
    }
    if (!files.length) {
        if (data.files.length || items.some(i => i.kind === "file")) trace("paste", "skipped: no image or video in the clipboard");
        return;
    }

    const editor = closestEditor(event.target);
    if (!editor) {
        trace("paste", "skipped: the target is not an editable field");
        return;
    }
    if (!isChatComposer(editor)) {
        trace("paste", `skipped: not the chat composer. Chain: ${ancestorChain(editor)}`);
        return;
    }

    let channelId: string | null = null;
    try {
        channelId = SelectedChannelStore.getChannelId() ?? null;
    } catch (error) {
        trace("paste", `skipped: couldn't read the selected channel (${String(error)})`);
        return;
    }
    if (!channelId) {
        trace("paste", "skipped: no channel selected");
        return;
    }
    if (EditMessageStore.getEditingMessage(channelId)) {
        trace("paste", "skipped: a message is being edited");
        return;
    }

    let target: { can: boolean; description: string; };
    try {
        target = attachmentDecision(channelId);
    } catch (error) {
        trace("paste", `permission check failed, uploading through the host (${String(error)})`);
        target = { can: false, description: "permission check failed" };
    }

    const what = files.map(f => `${f.name || f.type}(${f.type || "no type"}, ${f.size}B)`).join(", ");
    trace("paste", `${what} in ${target.description}`);

    if (target.can) {
        trace("paste", "Discord can attach here, leaving it to Discord");
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    trace("paste", "taking the files to the upload queue");
    void uploadProvidedFiles(files, { channelId, draftType: DraftType.ChannelMessage, automatic: true })
        .catch(error => logger.error("The pasted file upload failed", error));
}

let listening = false;

export function startPasteCapture(): void {
    if (listening) return;
    listening = true;
    window.addEventListener("paste", onPaste, true);
    trace("paste", "clipboard capture armed");
}

export function stopPasteCapture(): void {
    if (!listening) return;
    listening = false;
    window.removeEventListener("paste", onPaste, true);
    trace("paste", "clipboard capture stopped");
}
