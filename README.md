# Color Preview

An [Obsidian](https://obsidian.md) plugin that renders color swatches directly in your notes, with support for hex, RGB, CMYK, and PMS data. Built for brand guidelines, design systems, and color documentation.

## Features

- **Color cards** — render a visual swatch with all color data from a `color` fenced code block
- **Palette blocks** — display multiple colors side-by-side in a `palette` code block
- **Inline dot previews** — small color dots appear next to hex codes anywhere in your notes
- **Click swatch to edit** — click any swatch to open the system color picker and update the hex in place
- **Click to copy** — click any value (HTML, RGB, CMYK) to copy it to the clipboard
- **Auto-calculated values** — if only a hex is provided, RGB and CMYK are approximated automatically (shown in italic)
- **Multiple insertion methods** — ribbon icon, `/color` slash command, command palette, paste detection, and more
- **PDF/DOCX export safe** — underlying markdown stays readable as plain text when exported

## Usage

### Color block

````markdown
```color
name: Marineblå
hex: #23264F
rgb: 35, 38, 83
cmyk: 100, 94, 33, 33
pms: 524C
```
````

All fields except `hex` are optional. If `rgb` or `cmyk` are omitted, approximate values are calculated from the hex and shown in italic.

### Palette block

````markdown
```palette
#23264F Marineblå
#29306E Mellomblå
#2C4A9A Blå
#FFFFFF Hvit
```
````

Each line: `#hex [optional name]` or `name: #hex`. Renders as a horizontal strip of swatches. Click any swatch to copy its hex.

### Inline previews

Any hex code in backticks like `` `#23264F` `` or bare in text like `#23264F` gets a small color dot next to it automatically.

## Inserting colors

| Method | Description |
|---|---|
| **Ribbon icon** | Click the palette icon in the sidebar |
| **`/color`** | Type `/color` in the editor for a 4-option dropdown |
| **Command: color picker** | Opens the system color picker |
| **Command: type hex** | Small modal to type or paste a hex directly |
| **Command: from clipboard** | Reads a hex from the clipboard and inserts a block |
| **Command: empty template** | Inserts a blank color block to fill in manually |
| **Command: convert selection** | Converts selected old-format color text to a color block |
| **Paste detection** | Pasting a bare hex triggers a notice: insert as block or as text |

## Settings

| Setting | Default | Description |
|---|---|---|
| Swatch height | 80px | Height of the color rectangle |
| Max card width | 320px | Maximum width of the color card |
| Show color name | On | Whether to display the `name` field |

## Installation

### From Obsidian (once published)

1. Open **Settings → Community plugins**
2. Turn off Restricted mode
3. Click **Browse** and search for **Color Preview**
4. Click **Install**, then **Enable**

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest)
2. Copy them into `<vault>/.obsidian/plugins/color-preview/`
3. Reload Obsidian and enable the plugin in **Settings → Community plugins**

## License

[MIT](LICENSE)
