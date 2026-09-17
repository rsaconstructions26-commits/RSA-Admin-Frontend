import React, { useEffect, useState } from 'react';
import { materialApi, stockApi } from '../../api';
import { formatCurrency } from '../../utils/format.js';
import { useLanguage } from '../../context/LanguageContext.jsx';
import DateField from '../common/DateField.jsx';
import SelectField from '../common/SelectField.jsx';
import { advanceOnEnter } from '../../utils/formFlow.js';

/**
 * Item 9 (2026-09-15): "Closing Balance" sub-tab under New Material Entry.
 * The system already tracks a running Closing Balance for every material
 * automatically (opening + purchased - used) - this is for recording what a
 * physical stock count actually found. If the counted number differs from
 * what the system shows, one reconciling adjustment is posted (visible on
 * the Material Purchase Ledger as a "Closing Balance" row) so the running
 * balance matches the real count going forward.
 */
export default function ClosingBalanceForm({ onSaved }) {
  const { t } = useLanguage();
  const [materials, setMaterials] = useState([]);
  const [materialId, setMaterialId] = useState('');
  const [closingStock, setClosingStock] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    materialApi.list().then((res) => setMaterials(res.data || [])).catch(() => {});
  }, []);

  const selected = materials.find((m) => m._id === materialId);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    if (!materialId) {
      setError('Select a material first.');
      return;
    }
    if (closingStock === '' || Number(closingStock) < 0) {
      setError('Enter a Closing Balance of 0 or more.');
      return;
    }
    setSaving(true);
    try {
      const res = await stockApi.recordClosingBalance({
        materialId,
        closingStock: Number(closingStock),
        date,
        remarks,
      });
      setResult(res.data);
      setClosingStock('');
      setRemarks('');
      onSaved?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save Closing Balance');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="panel form" onSubmit={handleSubmit} onKeyDown={advanceOnEnter}>
      <h2>Closing Balance</h2>
      {error && <div className="alert alert-error">{error}</div>}
      {result && (
        <div className="field-hint">
          {result.delta === 0
            ? `Counted balance matches the system balance (${formatCurrency(result.counted)}). No adjustment needed.`
            : `System showed ${result.systemBalance}, physical count was ${result.counted} - a ${result.delta > 0 ? 'gain' : 'shortage'} of ${Math.abs(result.delta)} was posted to reconcile it.`}
        </div>
      )}
      <div className="form-grid">
        <div className="form-field">
          <label>{t('materials.materialName')}</label>
          <SelectField
            searchable
            placeholder="Select a material"
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
            options={materials.map((m) => ({ value: m._id, label: `${m.materialName} (${m.unit})` }))}
          />
        </div>
        <div className="form-field">
          <label>{t('materials.date')}</label>
          <DateField value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="form-field">
          <label>
            Closing Balance{selected ? ` (system: ${selected.remainingStock} ${selected.unit})` : ''}
          </label>
          <input type="number" min="0" step="0.01" value={closingStock} onChange={(e) => setClosingStock(e.target.value)} required />
        </div>
        <div className="form-field form-field-wide">
          <label>{t('materials.remarks')}</label>
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Physical stock count" />
        </div>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? t('materials.saving') : 'Save Closing Balance'}
        </button>
      </div>
    </form>
  );
}
