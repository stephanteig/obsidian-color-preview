import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
    ...obsidianmd.configs.recommended,
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: { project: "./tsconfig.json" },
            globals: {
                ...globals.browser,
                createEl: "readonly",
                createDiv: "readonly",
                createSpan: "readonly",
            },
        },
        rules: {
            // These are browser globals in Obsidian's environment
            "no-undef": "off",
        },
    },
]);
