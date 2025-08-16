// src/components/Filters.jsx
import React, { useMemo } from 'react';
import {
  TYPE_OPTIONS,
  RARITY_OPTIONS,
  ELEMENT_OPTIONS,
  DEFAULT_FILTERS,
} from '../filters.js';
import '../styles/filters.css';

const Select = ({ value, onChange, options, className }) => (
  <select className={className || 'filters-select'} value={value} onChange={(e)=>onChange(e.target.value)}>
    {options.map((opt)=> (<option key={opt} value={opt}>{opt}</option>))}
  </select>
);

export default function Filters({ filters, setFilters, onReset }) {
  const values = useMemo(() => ({ ...DEFAULT_FILTERS, ...(filters || {}) }), [filters]);

  const set = (k) => (v) => setFilters((prev)=> ({ ...prev, [k]: v }));
  const setEvt = (k) => (e) => set(e.target.value);

  return (
    <aside className="filters-panel" aria-label="Filters">
      <div className="filters-title">Filters</div>

      <div className="filters-group">
        <label className="filters-label" htmlFor="q">Search name or rules…</label>
        <input
          id="q"
          className="filters-input"
          placeholder="Search name or rules…"
          value={values.q}
          onChange={setEvt('q')}
        />
      </div>

      <div className="filters-row filters-group">
        <div style={{flex: 1}}>
          <label className="filters-label">Type</label>
          <Select value={values.type} onChange={set('type')} options={TYPE_OPTIONS} />
        </div>
        <div style={{flex: 1}}>
          <label className="filters-label">Rarity</label>
          <Select value={values.rarity} onChange={set('rarity')} options={RARITY_OPTIONS} />
        </div>
      </div>

      <div className="filters-group">
        <label className="filters-label">Element</label>
        <Select value={values.element} onChange={set('element')} options={ELEMENT_OPTIONS} />
      </div>

      <div className="filters-group">
        <label className="filters-label" htmlFor="costContains">Cost string contains (e.g. 1E4A)</label>
        <input
          id="costContains"
          className="filters-input"
          placeholder="e.g. 1E4A"
          value={values.costContains}
          onChange={setEvt('costContains')}
        />
      </div>

      <div className="filters-row filters-group">
        <div style={{flex: 1}}>
          <label className="filters-label" htmlFor="ccMin">Min CC</label>
          <input id="ccMin" className="filters-input" type="number" value={values.ccMin} onChange={setEvt('ccMin')} />
        </div>
        <div style={{flex: 1}}>
          <label className="filters-label" htmlFor="ccMax">Max CC</label>
          <input id="ccMax" className="filters-input" type="number" value={values.ccMax} onChange={setEvt('ccMax')} />
        </div>
      </div>

      <div className="filters-row filters-group">
        <div style={{flex: 1}}>
          <label className="filters-label" htmlFor="atkMin">ATK ≥</label>
          <input id="atkMin" className="filters-input" type="number" value={values.atkMin} onChange={setEvt('atkMin')} />
        </div>
        <div style={{flex: 1}}>
          <label className="filters-label" htmlFor="defMin">DEF ≥</label>
          <input id="defMin" className="filters-input" type="number" value={values.defMin} onChange={setEvt('defMin')} />
        </div>
        <div style={{flex: 1}}>
          <label className="filters-label" htmlFor="hpMin">HP ≥</label>
          <input id="hpMin" className="filters-input" type="number" value={values.hpMin} onChange={setEvt('hpMin')} />
        </div>
      </div>

      <div className="filters-actions">
        <button className="btn" onClick={onReset}>Clear</button>
      </div>

      <div className="filters-group">
        <p className="filters-help">Tip: leave blank for no limit. Stats accept empty values in your data.</p>
      </div>
    </aside>
  );
}