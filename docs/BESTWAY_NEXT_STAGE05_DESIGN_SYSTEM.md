# BESTWAY NEXT Stage 05 design system

The website theme in `frontend/src/app/globals.css` is the reference. The desktop mirrors the semantic color, typography and shape roles in `src/styles.css`. The website retains light and dark palettes. The desktop uses its existing navy shell, and the exam runner retains its own supported contrast preferences.

| Role | Website | Desktop |
|---|---|---|
| Page hierarchy | `PageHeader` with a wrapping title, optional context and primary actions | One workspace heading followed by task links and scoped panels |
| Surfaces and branding | Theme `bg`, `surface`, `border`, `fg`, `fg-muted`, `brand` | Corresponding semantic CSS variables, `workspace-panel` for quiet raised sections |
| Buttons, inputs and selects | Existing `Button`, `Input`, `Select` and control-radius tokens | `workspace-control` for new links, inputs and buttons, native elements and labels |
| Dialogs, tabs, tables, and tooltips | Existing UI primitives with labeled controls, managed focus and horizontal scrolling only inside data regions | Native dialog patterns and explicit labeled sections. Keep active exam controls under their existing rules |
| Success, pending, error and empty | Existing badges, feedback primitives and toasts. Render a retry for failed loads | Use text for every state alongside color, preserve pending operations until acknowledged, reserve live regions for meaningful changes |
| Motion | Use the existing reduced-motion rule | Disable route entry movement when the OS requests reduced motion |

Use the theme’s foreground and surface pairs. Emerald marks primary actions, blue communicates information and amber indicates unfinished work. Put the primary classroom or learning action first, keep controls at least 44 px tall in touched workspace sections, and let controls and text wrap. Use accessible names on icon controls and native search labels. Avoid decorative motion and repeated status indicators. New website workspace strings have English and Uzbek catalog entries. The desktop workspaces use the existing language preference where available. Older strings still need a catalog pass.

Within a busy dashboard, use previews that link to the full workflow. The server owns totals, scoring and authorization. Display skeletons or unavailable states while data is unknown. Restrict local data claims to a named study state such as downloaded, pending or synchronized.
