# Home Assistant configs

My Home Assistant configuration, kept as files. Each feature is a **page**: a package with its helpers and scripts, a view on the Home dashboard, and a doc that explains it. Pages are independent, so you can install one without the others.

## Pages

| Page | What it does | Doc |
|---|---|---|
| Irrigation | B-hyve sprinkler timers: run times, zone order with one start time, watering plan, live progress, rain delay and health | [docs/irrigation.md](docs/irrigation.md) |

## Layout

Files mirror the Home Assistant `/config` folder, so each one is copied to the same path there. Everything that belongs to a page is named after it.

```
packages/<page>.yaml                 helpers, scripts, template sensors, automations
dashboards/home/dashboard.yaml       the Home dashboard; lists one view per page
dashboards/home/views/<page>.yaml    the page itself
www/<card>.js                        custom cards a page needs (served at /local/<card>.js)
docs/<page>.md                       what the page does, its setup, entity IDs, troubleshooting
preview/<page>-preview.html, .png    optional standalone mock of the page and a screenshot
```

`docs/` and `preview/` are documentation only; they don't need to be copied to Home Assistant.

## Setup

Do this once. After that, each page's doc lists what that page needs.

1. **Install any HACS integrations and cards** listed in the doc of the pages you want.
2. **Add to `configuration.yaml`**, or merge into the blocks you already have:

   ```yaml
   homeassistant:
     packages: !include_dir_named packages

   lovelace:
     mode: storage            # your existing UI-edited dashboards keep working
     dashboards:
       dashboard-home:
         mode: yaml
         title: Home
         icon: mdi:home
         show_in_sidebar: true
         filename: dashboards/home/dashboard.yaml
   ```

   `packages:` loads every file in `packages/`, so new pages are picked up without editing this again. The Home dashboard is YAML-managed (edit the files, not the UI); your other dashboards stay as they are.
3. **Copy the files** for the pages you want, keeping their paths, plus `dashboards/home/dashboard.yaml`. If you skip a page, remove its `!include` line from `dashboard.yaml`.
4. **Follow each page's doc** (entity IDs to rename, custom cards to register), then restart Home Assistant.

## Custom cards

Cards in `www/` are registered once as dashboard resources:

1. Turn on Advanced mode in your user profile if it's off.
2. Settings → Dashboards → ⋮ (top right) → Resources → Add resource.
3. URL `/local/<card>.js`, type **JavaScript module**. Create, then refresh the browser.

| Card | Used by |
|---|---|
| `bhyve-zone-order-card.js` | Irrigation |

## Updating

| You changed | Then |
|---|---|
| A dashboard file | Refresh the browser |
| A package | Developer tools → YAML → reload the kinds of entities it defines (the page's doc lists them). Restart instead if you added a new package or a new kind of helper. |
| A card in `www/` | Refresh with the cache cleared, or bump the resource URL (`/local/<card>.js?v=2`, then `?v=3`, …) |

## Adding a page

1. Pick a short name, e.g. `lighting`, and use it for every file below.
2. `packages/lighting.yaml`: the page's helpers, scripts and template sensors. Prefix entity IDs with the page or device name so pages don't collide.
3. `dashboards/home/views/lighting.yaml`: the view (`title`, `path`, `icon`, `type: sections`), then add `- !include views/lighting.yaml` to `dashboards/home/dashboard.yaml`.
4. Any custom card goes in `www/`; add it to the [Custom cards](#custom-cards) table.
5. `docs/lighting.md`: what it does, requirements, setup, entity IDs, how it works, troubleshooting. [docs/irrigation.md](docs/irrigation.md) is a good model.
6. Optionally, `preview/lighting-preview.html` and a screenshot for the doc.
7. Add a row to the [Pages](#pages) table.
