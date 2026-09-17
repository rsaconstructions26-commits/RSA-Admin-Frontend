import React, { useEffect, useState } from 'react';
import { materialApi, stockApi, settingsApi } from '../../api';
import { useLanguage } from '../../context/LanguageContext.jsx';
import DateField from '../common/DateField.jsx';
import SelectField from '../common/SelectField.jsx';
import { advanceOnEnter } from '../../utils/formFlow.js';

/**
 * Item 9 (2026-09-15): "Opening Balance" sub-tab under New Material Entry.
 * Sets the starting stock figure a material's running balance counts from -
 * either for an existing material (pick it from the list, its current
 * opening balance is shown for reference) or a brand-new one (type a name
 * that isn't in the list yet, same as the main New Material Entry form).
 */
export default function OpeningBalanceForm({ onSaved }) {
  const { t } = useLanguage();
  const [materials, setMaterials] = useState([]);
  const [materialId, setMaterialId] = useState('');
  const [materialName, setMaterialName] = useState('');
  const [unit, setUnit] = useState('');
  const [unitOptions, setUnitOptions] = useState([]);
  const [openingStock, setOpeningStock] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    materialApi.list().then((res) => setMaterials(res.data || [])).catch(() => {});
    settingsApi.get().then((res) => setUnitOptions(res.data.materialUnits || [])).catch(() => {});
  }, []);

  const selected = materials.find((m) => m._id === materialId);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!materialId && (!materialName.trim() || !unit.trim())) {
      setError('Pick an existing material, or enter a name and unit for a new one.');
      return;
    }
    if (openingStock === '' || Number(openingStock) < 0) {
      setError('Enter an Opening Balance of 0 or more.');
      return;
    }
    setSaving(true);
    try {
      await stockApi.setOpeningBalance({
        materialId: materialId || undefined,
        materialName: materialId ? undefined : materialName.trim(),
        unit: materialId ? undefined : unit.trim(),
        openingStock: Number(openingStock),
        date,
        remarks,
      });
      setNotice('Opening Balance saved.');
      setOpeningStock('');
      setRemarks('');
      onSaved?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save Opening Balance');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="panel form" onSubmit={handleSubmit} onKeyDown={advanceOnEnter}>
      <h2>Opening Balance</h2>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="field-hint">{notice}</div>}
      <div className="form-grid">
        <div className="form-field">
          <label>{t('materials.materialName')}</label>
          <SelectField
            searchable
            allowClear
            clearLabel="-- new material --"
            placeholder="Select an existing material"
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
            options={materials.map((m) => ({ value: m._id, label: `${m.materialName} (${m.unit})` }))}
          />
        </div>
        {!materialId && (
          <>
            <div className="form-field">
              <label>New Material Name</label>
              <input value={materialName} onChange={(e) => setMaterialName(e.target.value)} placeholder="e.g. Cement" />
            </div>
            <div className="form-field">
              <label>{t('materials.unit')}</label>
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="Bags, Tons, Nos, Ft..."
                list="opening-balance-unit-options"
              />
              <datalist id="opening-balance-unit-options">
                {unitOptions.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
          </>
        )}
        <div className="form-field">
          <label>{t('materials.date')}</label>
          <DateField value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="form-field">
          <label>Opening Balance{selected ? ` (current: ${selected.openingStock} ${selected.unit})` : ''}</label>
          <input type="number" min="0" step="0.01" value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} required />
        </div>
        <div className="form-field form-field-wide">
          <label>{t('materials.remarks')}</label>
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? t('materials.saving') : 'Save Opening Balance'}
        </button>
      </div>
    </form>
  );
}
