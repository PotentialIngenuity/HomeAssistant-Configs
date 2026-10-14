// Drag-and-drop zone order for the B-hyve package.
//
// Lists the zones sorted by input_number.<zone>_order (ties by list position)
// and, after a drag, writes positions 1..N back to those helpers. Works with
// mouse, touch and keyboard (focus a handle, then arrow up/down).
//
//   type: custom:bhyve-zone-order-card
//   title: Order                  # optional
//   minutes_sensor: sensor.watering_order   # optional; run times scaled by the budget
//   zones:                        # valves; helper is input_number.<object id>_order
//     - valve.bhyve_zone_1
//     - ...

class BhyveZoneOrderCard extends HTMLElement {
  setConfig(config) {
    if (!Array.isArray(config.zones) || !config.zones.length) {
      throw new Error("zones: list the zone valves");
    }
    this._config = config;
    this._order = null;
    this._drag = null;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._drag || this._saving) return;
    const key = this._config.zones
      .map((z) => [this._pos(z), this._name(z), this._mins(z)].join("|"))
      .join(";");
    if (key === this._key) return;
    this._key = key;
    this._order = this._sorted();
    this._render();
  }

  getCardSize() {
    return 1 + this._config.zones.length;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6 };
  }

  _helper(zone, suffix) {
    return `input_number.${zone.split(".")[1]}_${suffix}`;
  }

  _pos(zone) {
    const v = parseFloat(this._hass?.states[this._helper(zone, "order")]?.state);
    return Number.isFinite(v) ? v : 99;
  }

  // The budget-scaled run time from the package's sensor, else the raw slider.
  _mins(zone) {
    const scaled = this._hass?.states[this._config.minutes_sensor || "sensor.watering_order"]?.attributes.minutes;
    if (scaled && zone in scaled) return Math.round(scaled[zone]);
    const v = parseFloat(this._hass?.states[this._helper(zone, "minutes")]?.state);
    return Number.isFinite(v) ? Math.round(v) : null;
  }

  _name(zone) {
    return this._hass?.states[zone]?.attributes.friendly_name || zone;
  }

  _sorted() {
    const zones = this._config.zones;
    return zones
      .map((z, i) => ({ z, k: this._pos(z) * 100 + i }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.z);
  }

  _render() {
    if (!this._built) {
      this.shadowRoot.innerHTML = `
        <style>
          ha-card { padding: 4px 0 8px; }
          h1 { margin: 0; padding: 12px 16px 4px; font-size: 16px; font-weight: 400; }
          ol { list-style: none; margin: 0; padding: 4px 8px 0; position: relative; }
          li { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto 40px; align-items: center; gap: 8px;
               padding: 6px 4px 6px 8px; margin: 2px 0; border-radius: 10px; background: var(--card-background-color);
               border: 1px solid transparent; touch-action: pan-y; }
          li.dragging { position: relative; z-index: 1; border-color: var(--primary-color);
                        box-shadow: 0 4px 12px rgba(0, 0, 0, .2); }
          .n { color: var(--secondary-text-color); font-variant-numeric: tabular-nums; text-align: right; }
          .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .m { color: var(--secondary-text-color); font-size: 13px; font-variant-numeric: tabular-nums; }
          .m.off { font-style: italic; }
          button { width: 40px; height: 40px; border: 0; background: none; color: var(--secondary-text-color);
                   border-radius: 50%; cursor: grab; touch-action: none; display: grid; place-items: center; padding: 0; }
          button:focus-visible { outline: 2px solid var(--primary-color); }
          li.dragging button { cursor: grabbing; color: var(--primary-color); }
          .hint { padding: 6px 16px 0; font-size: 12px; color: var(--secondary-text-color); }
        </style>
        <ha-card>
          ${this._config.title === false ? "" : `<h1>${this._esc(this._config.title || "Order")}</h1>`}
          <ol></ol>
          <div class="hint">Drag to reorder. Cycles water from the top down.</div>
        </ha-card>`;
      this._list = this.shadowRoot.querySelector("ol");
      this._list.addEventListener("pointerdown", (e) => this._start(e));
      this._list.addEventListener("keydown", (e) => this._key_(e));
      this._built = true;
    }
    this._list.innerHTML = this._order
      .map((z, i) => {
        const m = this._mins(z);
        return `<li data-z="${this._esc(z)}">
          <span class="n">${i + 1}</span>
          <span class="name">${this._esc(this._name(z))}</span>
          <span class="m${m === 0 ? " off" : ""}">${m === null ? "" : m === 0 ? "skipped" : m + " min"}</span>
          <button type="button" aria-label="Move ${this._esc(this._name(z))}, position ${i + 1}">
            <ha-icon icon="mdi:drag"></ha-icon></button></li>`;
      })
      .join("");
  }

  _start(e) {
    const btn = e.target.closest("button");
    if (!btn || e.button > 0) return;
    e.preventDefault();
    const li = btn.closest("li");
    this._drag = { li, y0: e.clientY, moved: false, id: e.pointerId };
    li.classList.add("dragging");
    // Listen on the window so the drag keeps tracking wherever the pointer goes.
    const move = (ev) => ev.pointerId === e.pointerId && this._move(ev);
    const end = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      li.classList.remove("dragging");
      li.style.transform = "";
      const moved = this._drag.moved;
      this._drag = null;
      if (moved) this._commit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  // Swap the dragged row with a neighbour once the pointer passes its middle.
  // The neighbour is the one moved, so the dragged row stays in the DOM.
  _move(e) {
    const d = this._drag;
    const li = d.li;
    const dy0 = e.clientY - d.y0;
    const prev = li.previousElementSibling;
    const next = li.nextElementSibling;
    const top = li.offsetTop;
    if (next && dy0 > next.offsetHeight / 2) li.before(next);
    else if (prev && dy0 < -prev.offsetHeight / 2) li.after(prev);
    if (li.offsetTop !== top) {
      // Keep the row under the pointer: shift the origin by how far the slot moved.
      d.y0 += li.offsetTop - top;
      d.moved = true;
    }
    // Keep the row between the first and last slots of the list.
    const list = li.parentNode;
    const min = list.firstElementChild.offsetTop - li.offsetTop;
    const max = list.lastElementChild.offsetTop - li.offsetTop;
    const dy = Math.min(max, Math.max(min, e.clientY - d.y0));
    li.style.transform = `translateY(${dy}px)`;
    this._renumber();
  }

  _key_(e) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const btn = e.target.closest("button");
    if (!btn) return;
    e.preventDefault();
    const li = btn.closest("li");
    if (e.key === "ArrowUp" && li.previousElementSibling) li.after(li.previousElementSibling);
    else if (e.key === "ArrowDown" && li.nextElementSibling) li.before(li.nextElementSibling);
    else return;
    btn.focus();
    this._renumber();
    this._commit();
  }

  _renumber() {
    [...this._list.children].forEach((li, i) => {
      li.querySelector(".n").textContent = i + 1;
      const b = li.querySelector("button");
      b.setAttribute("aria-label", b.getAttribute("aria-label").replace(/position \d+$/, `position ${i + 1}`));
    });
  }

  // Write positions 1..N, only for helpers whose value changed.
  async _commit() {
    this._order = [...this._list.children].map((li) => li.dataset.z);
    this._saving = true;
    try {
      await Promise.all(
        this._order
          .map((z, i) => [z, i + 1])
          .filter(([z, p]) => this._pos(z) !== p)
          .map(([z, p]) =>
            this._hass.callService("input_number", "set_value", {
              entity_id: this._helper(z, "order"),
              value: p,
            })
          )
      );
    } finally {
      this._saving = false;
      this._key = null;
    }
  }

  _esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }
}

customElements.define("bhyve-zone-order-card", BhyveZoneOrderCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "bhyve-zone-order-card",
  name: "B-hyve zone order",
  description: "Drag zones into the order cycles water them.",
});
