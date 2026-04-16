import {
    App,
    Editor,
    EditorPosition,
    EditorSuggest,
    EditorSuggestContext,
    EditorSuggestTriggerInfo,
    MarkdownPostProcessorContext,
    MarkdownView,
    Modal,
    Notice,
    Platform,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
} from "obsidian";

// ─── Settings ────────────────────────────────────────────────────────────────

interface ColorPreviewSettings {
    swatchHeight: number;
    maxWidth: number;
    showColorName: boolean;
}

const DEFAULT_SETTINGS: ColorPreviewSettings = {
    swatchHeight: 80,
    maxWidth: 320,
    showColorName: true,
};

// ─── Slash suggestion type ────────────────────────────────────────────────────

interface SlashSuggestion {
    label: string;
    action: "picker" | "hex-modal" | "clipboard" | "template";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeHex(raw: string): string {
    const h = raw.replace(/`/g, "").trim();
    const upper = h.toUpperCase();
    return upper.startsWith("#") ? upper : `#${upper}`;
}

function isValidHex(s: string): boolean {
    return /^#?[0-9a-fA-F]{6}$/.test(s.trim());
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const clean = hex.replace(/^#/, "");
    const m = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(clean);
    return m
        ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
        : null;
}

function rgbToCmyk(r: number, g: number, b: number): { c: number; m: number; y: number; k: number } {
    const rr = r / 255, gg = g / 255, bb = b / 255;
    const k = 1 - Math.max(rr, gg, bb);
    if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
    const d = 1 - k;
    return {
        c: Math.round(((1 - rr - k) / d) * 100),
        m: Math.round(((1 - gg - k) / d) * 100),
        y: Math.round(((1 - bb - k) / d) * 100),
        k: Math.round(k * 100),
    };
}

function isLightColor(hex: string): boolean {
    const rgb = hexToRgb(hex);
    if (!rgb) return true;
    return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255 > 0.55;
}

function parseColorSource(source: string): Record<string, string> {
    const data: Record<string, string> = {};
    for (const line of source.trim().split("\n")) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim().replace(/`/g, "");
        if (key && value) data[key] = value;
    }
    return data;
}

function buildColorBlock(hex: string, name?: string): string {
    const rgb = hexToRgb(hex);
    const lines = ["```color"];
    if (name) lines.push(`name: ${name}`);
    lines.push(`hex: ${hex}`);
    if (rgb) lines.push(`rgb: ${rgb.r}, ${rgb.g}, ${rgb.b}`);
    lines.push("```");
    return lines.join("\n");
}

const PENCIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class ColorPreviewPlugin extends Plugin {
    settings: ColorPreviewSettings;

    async onload() {
        await this.loadSettings();

        // ── Code block processors ──────────────────────────────────────────
        this.registerMarkdownCodeBlockProcessor("color", (source, el, ctx) => {
            this.renderColorBlock(source, el, ctx);
        });

        this.registerMarkdownCodeBlockProcessor("palette", (source, el, _ctx) => {
            this.renderPaletteBlock(source, el);
        });

        // ── Inline hex dot preview ─────────────────────────────────────────
        this.registerMarkdownPostProcessor((el) => {
            this.addInlineHexPreviews(el);
        });

        // ── Commands ───────────────────────────────────────────────────────
        this.addCommand({
            id: "insert-color-picker",
            name: "Insert color (color picker)",
            editorCallback: (editor) => this.insertColorWithPicker(editor),
        });

        this.addCommand({
            id: "insert-color-hex",
            name: "Insert color (type hex)",
            editorCallback: (editor) => this.openQuickHexModal(editor),
        });

        this.addCommand({
            id: "insert-color-clipboard",
            name: "Insert color from clipboard",
            editorCallback: (editor) => this.insertFromClipboard(editor),
        });

        this.addCommand({
            id: "insert-color-template",
            name: "Insert empty color block",
            editorCallback: (editor) => this.insertTemplate(editor),
        });

        this.addCommand({
            id: "convert-to-color-block",
            name: "Convert selection to color block",
            editorCallback: (editor) => this.convertSelectionToBlock(editor),
        });

        // ── Ribbon button ──────────────────────────────────────────────────
        this.addRibbonIcon("palette", "Insert color", () => {
            const editor = this.app.workspace.activeEditor?.editor;
            if (editor) this.insertColorWithPicker(editor);
            else new Notice("Open a note first.");
        });

        // ── Slash command suggest (/color) ─────────────────────────────────
        this.registerEditorSuggest(new ColorSlashSuggest(this));

        // ── Paste detection (desktop only — iOS WebKit paste events unreliable) ──
        if (!Platform.isMobile) {
            this.registerDomEvent(document, "paste", (evt: ClipboardEvent) => {
                this.handlePaste(evt);
            }, true); // capture phase — intercepts before CM6 handles it
        }

        this.addSettingTab(new ColorPreviewSettingTab(this.app, this));
    }

    // ── Render: color block ───────────────────────────────────────────────────

    renderColorBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
        const data = parseColorSource(source);
        const rawHex = (data["hex"] || data["html"] || data["color"] || "").trim();
        const hex = rawHex ? normalizeHex(rawHex) : "";

        const name    = data["name"]  || "";
        const hasRgb  = !!data["rgb"];
        const hasCmyk = !!data["cmyk"];
        const hasPms  = !!data["pms"];

        // Derive calculated values from hex
        const rgb = hexToRgb(hex);
        const calcRgbStr  = rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : "";
        const calcCmykObj = rgb ? rgbToCmyk(rgb.r, rgb.g, rgb.b) : null;
        const calcCmykStr = calcCmykObj
            ? `${calcCmykObj.c}, ${calcCmykObj.m}, ${calcCmykObj.y}, ${calcCmykObj.k}`
            : "";

        const rgbDisplay  = data["rgb"]  || calcRgbStr;
        const cmykDisplay = data["cmyk"] || calcCmykStr;
        const pmsDisplay  = data["pms"]  || "";

        const container = el.createDiv({ cls: "cp-container" });
        container.style.maxWidth = `${this.settings.maxWidth}px`;

        // ── Swatch ──────────────────────────────────────────────────────────
        const swatch = container.createDiv({ cls: "cp-swatch" });
        swatch.style.height = `${this.settings.swatchHeight}px`;

        if (hex) {
            swatch.style.backgroundColor = hex;
            const swatchHex = swatch.createDiv({ cls: "cp-swatch-hex" });
            swatchHex.textContent = hex;
            swatchHex.style.color = isLightColor(hex) ? "#222" : "#fff";
        } else {
            swatch.classList.add("cp-swatch-empty");
        }

        const editIcon = swatch.createDiv({ cls: "cp-edit-icon" });
        editIcon.innerHTML = PENCIL_SVG;
        if (hex) editIcon.style.color = isLightColor(hex) ? "#222" : "#fff";

        // Click swatch → edit color in place
        swatch.addEventListener("click", () => this.editColorInPlace(el, ctx, hex));

        // ── Info ────────────────────────────────────────────────────────────
        const info = container.createDiv({ cls: "cp-info" });

        if (name && this.settings.showColorName) {
            info.createDiv({ cls: "cp-name", text: name });
        }

        const rows: { label: string; value: string; mono: boolean; calculated: boolean }[] = [
            { label: "HTML",  value: hex,          mono: true,  calculated: false },
            { label: "RGB",   value: rgbDisplay,   mono: false, calculated: !hasRgb  && !!calcRgbStr  },
            { label: "CMYK",  value: cmykDisplay,  mono: false, calculated: !hasCmyk && !!calcCmykStr },
            { label: "PMS",   value: pmsDisplay,   mono: false, calculated: false },
        ];

        for (const row of rows) {
            if (!row.value) continue;
            const rowEl = info.createDiv({ cls: "cp-row" });
            rowEl.createSpan({ cls: "cp-label", text: `${row.label}: ` });

            const cls = ["cp-value", row.mono ? "cp-mono" : "", row.calculated ? "cp-calculated" : ""]
                .filter(Boolean).join(" ");
            const valSpan = rowEl.createSpan({ cls, text: row.value });

            if (row.calculated) {
                rowEl.createSpan({ cls: "cp-approx", text: " ~" });
            }

            // Click to copy
            valSpan.classList.add("cp-copyable");
            valSpan.title = "Click to copy";
            valSpan.addEventListener("click", () => {
                navigator.clipboard.writeText(row.value).then(() => {
                    const orig = valSpan.textContent ?? row.value;
                    valSpan.textContent = "Copied!";
                    valSpan.classList.add("cp-copied");
                    setTimeout(() => {
                        valSpan.textContent = orig;
                        valSpan.classList.remove("cp-copied");
                    }, 1200);
                });
            });
        }

        if ((!hasCmyk && calcCmykStr) || (!hasRgb && calcRgbStr)) {
            info.createDiv({ cls: "cp-calc-note", text: "~ approximate calculated value" });
        }
    }

    // ── Edit color in place ───────────────────────────────────────────────────

    private editColorInPlace(el: HTMLElement, ctx: MarkdownPostProcessorContext, currentHex: string) {
        const applyHex = async (newHex: string) => {
            const sectionInfo = ctx.getSectionInfo(el);
            if (!sectionInfo) return;
            const editor = this.app.workspace.activeEditor?.editor;
            if (editor) {
                this.replaceHexInEditor(editor, sectionInfo.lineStart, sectionInfo.lineEnd, newHex);
            } else {
                const file = this.app.workspace.getActiveFile();
                if (!file) return;
                const content = await this.app.vault.read(file);
                const lines = content.split("\n");
                this.replaceHexInLines(lines, sectionInfo.lineStart, sectionInfo.lineEnd, newHex);
                await this.app.vault.modify(file, lines.join("\n"));
            }
        };

        // iOS / mobile: native color picker input doesn't open programmatically —
        // fall back to the hex modal pre-filled with the current color
        if (Platform.isMobile) {
            new QuickHexModal(this.app, (newHex) => applyHex(newHex), currentHex).open();
            return;
        }

        // Desktop: hidden color input + system picker
        const input = document.createElement("input");
        input.type = "color";
        input.value = isValidHex(currentHex) ? currentHex : "#000000";
        input.style.cssText = "position:fixed;opacity:0;pointer-events:none;";
        document.body.appendChild(input);

        let done = false;
        const apply = () => {
            if (done) return;
            done = true;
            applyHex(input.value.toUpperCase());
            cleanup();
        };
        const cleanup = () => {
            input.removeEventListener("change", apply);
            if (document.body.contains(input)) document.body.removeChild(input);
        };
        input.addEventListener("change", apply);
        input.addEventListener("blur", () => setTimeout(cleanup, 200));
        input.click();
    }

    private replaceHexInEditor(editor: Editor, lineStart: number, lineEnd: number, newHex: string) {
        for (let i = lineStart; i <= lineEnd; i++) {
            const line = editor.getLine(i);
            if (/^hex:/i.test(line.trim())) {
                editor.replaceRange(`hex: ${newHex}`, { line: i, ch: 0 }, { line: i, ch: line.length });
                return;
            }
        }
        // No hex line found — insert after opening fence
        const insertAt = lineStart + 1;
        editor.replaceRange(`hex: ${newHex}\n`, { line: insertAt, ch: 0 }, { line: insertAt, ch: 0 });
    }

    private replaceHexInLines(lines: string[], lineStart: number, lineEnd: number, newHex: string) {
        for (let i = lineStart; i <= lineEnd; i++) {
            if (/^hex:/i.test((lines[i] ?? "").trim())) {
                lines[i] = `hex: ${newHex}`;
                return;
            }
        }
        lines.splice(lineStart + 1, 0, `hex: ${newHex}`);
    }

    // ── Render: palette block ─────────────────────────────────────────────────

    renderPaletteBlock(source: string, el: HTMLElement) {
        const strip = el.createDiv({ cls: "cp-palette" });

        for (const rawLine of source.trim().split("\n")) {
            const line = rawLine.trim();
            if (!line) continue;

            // Accept: `#hex [name]` or `name: #hex`
            let hex = "";
            let name = "";
            const colonIdx = line.indexOf(":");
            if (colonIdx !== -1) {
                name = line.slice(0, colonIdx).trim();
                hex  = normalizeHex(line.slice(colonIdx + 1).trim());
            } else {
                const parts = line.split(/\s+/);
                hex  = normalizeHex(parts[0]);
                name = parts.slice(1).join(" ");
            }
            if (!isValidHex(hex)) continue;

            const swatch = strip.createDiv({ cls: "cp-palette-swatch" });
            swatch.style.backgroundColor = hex;
            swatch.title = name ? `${name} — ${hex}` : hex;

            const label = swatch.createDiv({ cls: "cp-palette-label" });
            label.style.color = isLightColor(hex) ? "#222" : "#fff";
            if (name) label.createDiv({ cls: "cp-palette-name", text: name });
            const hexEl = label.createDiv({ cls: "cp-palette-hex", text: hex });

            // Click to copy hex
            swatch.addEventListener("click", () => {
                navigator.clipboard.writeText(hex).then(() => {
                    const orig = hexEl.textContent ?? hex;
                    hexEl.textContent = "Copied!";
                    setTimeout(() => { hexEl.textContent = orig; }, 1200);
                });
            });
        }
    }

    // ── Inline hex dot preview ────────────────────────────────────────────────

    addInlineHexPreviews(el: HTMLElement) {
        if (el.closest(".cp-container, .cp-palette")) return;

        // Inline code: `#RRGGBB`
        el.querySelectorAll("code").forEach((code) => {
            if (code.closest(".cp-container, .cp-palette")) return;
            const text = (code.textContent ?? "").trim();
            if (!/^#?[0-9a-fA-F]{6}$/i.test(text)) return;
            const hex = text.startsWith("#") ? text : `#${text}`;
            const dot = createEl("span", { cls: "cp-inline-dot" });
            dot.style.backgroundColor = hex;
            code.insertBefore(dot, code.firstChild);
        });

        // Plain text: bare #RRGGBB
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const p = node.parentElement;
                if (!p) return NodeFilter.FILTER_REJECT;
                if (p.closest("code, pre, .cp-container, .cp-palette")) return NodeFilter.FILTER_REJECT;
                return /#[0-9a-fA-F]{6}/i.test(node.textContent ?? "")
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            },
        });

        const textNodes: Text[] = [];
        let n: Node | null;
        while ((n = walker.nextNode())) textNodes.push(n as Text);

        for (const textNode of textNodes) {
            const text = textNode.textContent ?? "";
            const re = /#([0-9a-fA-F]{6})\b/gi;
            if (!re.test(text)) continue;
            re.lastIndex = 0;

            const frag = document.createDocumentFragment();
            let last = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) {
                if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
                const wrap = createEl("span", { cls: "cp-inline-hex" });
                const dot  = createEl("span", { cls: "cp-inline-dot" });
                dot.style.backgroundColor = m[0];
                wrap.appendChild(dot);
                wrap.appendChild(document.createTextNode(m[0]));
                frag.appendChild(wrap);
                last = m.index + m[0].length;
            }
            if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
            textNode.parentNode?.replaceChild(frag, textNode);
        }
    }

    // ── Insertion methods ─────────────────────────────────────────────────────

    insertColorWithPicker(editor: Editor) {
        // Mobile: fall back to hex modal
        if (Platform.isMobile) {
            this.openQuickHexModal(editor);
            return;
        }

        const input = document.createElement("input");
        input.type = "color";
        input.value = "#000000";
        input.style.cssText = "position:fixed;opacity:0;pointer-events:none;";
        document.body.appendChild(input);

        let done = false;
        const insert = () => {
            if (done) return;
            done = true;
            editor.replaceSelection(buildColorBlock(input.value.toUpperCase()));
            cleanup();
        };
        const cleanup = () => {
            input.removeEventListener("change", insert);
            if (document.body.contains(input)) document.body.removeChild(input);
        };
        input.addEventListener("change", insert);
        input.addEventListener("blur", () => setTimeout(cleanup, 200));
        input.click();
    }

    openQuickHexModal(editor: Editor) {
        new QuickHexModal(this.app, (hex) => {
            editor.replaceSelection(buildColorBlock(hex));
        }).open();
    }

    async insertFromClipboard(editor: Editor) {
        try {
            const text = (await navigator.clipboard.readText()).trim();
            if (isValidHex(text)) {
                editor.replaceSelection(buildColorBlock(normalizeHex(text)));
            } else {
                new Notice("Clipboard does not contain a valid hex color.");
            }
        } catch {
            new Notice("Could not read clipboard.");
        }
    }

    insertTemplate(editor: Editor) {
        const template = [
            "```color",
            "name: ",
            "hex: #",
            "rgb: ",
            "cmyk: ",
            "pms: ",
            "```",
        ].join("\n");
        editor.replaceSelection(template);
    }

    convertSelectionToBlock(editor: Editor) {
        const sel = editor.getSelection();
        if (!sel.trim()) return;

        const data: Record<string, string> = {};
        for (const line of sel.split("\n")) {
            const clean = line.replace(/\*\*/g, "").trim();
            const lower = clean.toLowerCase();
            if (lower.startsWith("html:") || lower.startsWith("hex:")) {
                data["hex"] = clean.replace(/^html:/i, "").replace(/^hex:/i, "").replace(/`/g, "").trim();
            } else if (lower.startsWith("rgb:")) {
                data["rgb"] = clean.replace(/^rgb:/i, "").trim();
            } else if (lower.startsWith("cmyk:")) {
                data["cmyk"] = clean.replace(/^cmyk:/i, "").trim();
            } else if (lower.startsWith("pms:")) {
                data["pms"] = clean.replace(/^pms:/i, "").trim();
            } else if (clean && !Object.keys(data).length && !clean.includes(":")) {
                data["name"] = clean;
            }
        }

        const lines = ["```color"];
        if (data["name"])  lines.push(`name: ${data["name"]}`);
        if (data["hex"])   lines.push(`hex: ${data["hex"]}`);
        if (data["rgb"])   lines.push(`rgb: ${data["rgb"]}`);
        if (data["cmyk"])  lines.push(`cmyk: ${data["cmyk"]}`);
        if (data["pms"])   lines.push(`pms: ${data["pms"]}`);
        lines.push("```");
        editor.replaceSelection(lines.join("\n"));
    }

    // ── Paste detection ───────────────────────────────────────────────────────

    handlePaste(evt: ClipboardEvent) {
        const text = evt.clipboardData?.getData("text/plain")?.trim() ?? "";
        if (!isValidHex(text)) return;

        // Only intercept when a markdown editor is focused
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;
        const editor = activeView.editor;
        if (!editor.hasFocus()) return;

        evt.preventDefault();
        const hex = normalizeHex(text);

        const notice = new Notice("", 10000);
        notice.noticeEl.empty();
        notice.noticeEl.createDiv({ cls: "cp-notice-title", text: `Hex color detected: ${hex}` });

        const preview = notice.noticeEl.createDiv({ cls: "cp-notice-preview" });
        preview.style.backgroundColor = hex;

        const btnRow = notice.noticeEl.createDiv({ cls: "cp-notice-btns" });

        let dismissed = false;
        const dismiss = (action: "block" | "text" | "none") => {
            if (dismissed) return;
            dismissed = true;
            if (action === "block") editor.replaceSelection(buildColorBlock(hex));
            if (action === "text")  editor.replaceSelection(hex);
            notice.hide();
        };

        btnRow.createEl("button", { text: "Insert as block", cls: "cp-notice-btn cp-notice-btn-primary" })
            .addEventListener("click", () => dismiss("block"));
        btnRow.createEl("button", { text: "Insert as text", cls: "cp-notice-btn" })
            .addEventListener("click", () => dismiss("text"));

        // Auto-dismiss as text after 10 s
        setTimeout(() => dismiss("text"), 10000);
    }

    // ── Persistence ───────────────────────────────────────────────────────────

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }
    async saveSettings() {
        await this.saveData(this.settings);
    }
}

// ─── Slash command suggest (/color …) ────────────────────────────────────────

class ColorSlashSuggest extends EditorSuggest<SlashSuggestion> {
    plugin: ColorPreviewPlugin;

    constructor(plugin: ColorPreviewPlugin) {
        super(plugin.app);
        this.plugin = plugin;
    }

    onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile): EditorSuggestTriggerInfo | null {
        const line = editor.getLine(cursor.line);
        const sub  = line.substring(0, cursor.ch);
        const m    = sub.match(/(\/color.*)$/i);
        if (!m) return null;
        return {
            start: { line: cursor.line, ch: sub.length - m[1].length },
            end: cursor,
            query: m[1].slice("/color".length).trim(),
        };
    }

    getSuggestions(_ctx: EditorSuggestContext): SlashSuggestion[] {
        return [
            { label: "🎨  Color picker",    action: "picker"    },
            { label: "⌨️   Type hex code",   action: "hex-modal" },
            { label: "📋  From clipboard",  action: "clipboard" },
            { label: "📝  Empty template",  action: "template"  },
        ];
    }

    renderSuggestion(item: SlashSuggestion, el: HTMLElement) {
        el.createDiv({ cls: "cp-suggest-item", text: item.label });
    }

    selectSuggestion(item: SlashSuggestion, _evt: MouseEvent | KeyboardEvent) {
        const ctx = this.context;
        if (!ctx) return;
        ctx.editor.replaceRange("", ctx.start, ctx.end);
        switch (item.action) {
            case "picker":    this.plugin.insertColorWithPicker(ctx.editor); break;
            case "hex-modal": this.plugin.openQuickHexModal(ctx.editor);     break;
            case "clipboard": this.plugin.insertFromClipboard(ctx.editor);   break;
            case "template":  this.plugin.insertTemplate(ctx.editor);        break;
        }
    }
}

// ─── Quick hex modal ──────────────────────────────────────────────────────────

class QuickHexModal extends Modal {
    onSubmit: (hex: string) => void;
    initialValue: string;

    constructor(app: App, onSubmit: (hex: string) => void, initialValue = "") {
        super(app);
        this.onSubmit = onSubmit;
        this.initialValue = initialValue;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "Enter hex color" });

        const wrapper = contentEl.createDiv({ cls: "cp-modal-wrapper" });
        const preview = wrapper.createDiv({ cls: "cp-modal-preview" });
        const startColor = isValidHex(this.initialValue) ? normalizeHex(this.initialValue) : "#000000";
        preview.style.backgroundColor = startColor;

        const input = wrapper.createEl("input", {
            cls: "cp-modal-input",
            attr: { type: "text", placeholder: "#000000", spellcheck: "false", value: startColor },
        });

        input.addEventListener("input", () => {
            if (isValidHex(input.value.trim())) {
                preview.style.backgroundColor = normalizeHex(input.value.trim());
                preview.style.opacity = "1";
            } else {
                preview.style.opacity = "0.25";
            }
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                if (isValidHex(input.value.trim())) {
                    this.onSubmit(normalizeHex(input.value.trim()));
                    this.close();
                } else {
                    input.addClass("cp-modal-error");
                    setTimeout(() => input.removeClass("cp-modal-error"), 600);
                }
            }
            if (e.key === "Escape") this.close();
        });

        contentEl.createEl("button", { text: "Insert", cls: "cp-modal-btn mod-cta" })
            .addEventListener("click", () => {
                if (isValidHex(input.value.trim())) {
                    this.onSubmit(normalizeHex(input.value.trim()));
                    this.close();
                }
            });

        setTimeout(() => input.focus(), 50);
    }

    onClose() { this.contentEl.empty(); }
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

class ColorPreviewSettingTab extends PluginSettingTab {
    plugin: ColorPreviewPlugin;

    constructor(app: App, plugin: ColorPreviewPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Color Preview" });

        new Setting(containerEl)
            .setName("Swatch height")
            .setDesc("Height of the color rectangle in pixels (40–200)")
            .addSlider((s) => s.setLimits(40, 200, 10)
                .setValue(this.plugin.settings.swatchHeight)
                .setDynamicTooltip()
                .onChange(async (v) => { this.plugin.settings.swatchHeight = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName("Max card width")
            .setDesc("Maximum width of the color card in pixels (180–600)")
            .addSlider((s) => s.setLimits(180, 600, 20)
                .setValue(this.plugin.settings.maxWidth)
                .setDynamicTooltip()
                .onChange(async (v) => { this.plugin.settings.maxWidth = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName("Show color name")
            .setDesc("Display the name field in the preview card")
            .addToggle((t) => t.setValue(this.plugin.settings.showColorName)
                .onChange(async (v) => { this.plugin.settings.showColorName = v; await this.plugin.saveSettings(); }));
    }
}
