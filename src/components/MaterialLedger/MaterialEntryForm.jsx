import React, { useEffect, useState } from 'react';
import { materialApi, settingsApi } from '../../api';
import { formatCurrency } from '../../utils/format.js';
import { useLanguage } from '../../context/LanguageContext.jsx';
import DateField from '../common/DateField.jsx';
import SelectField from '../common/SelectField.jsx';
import { advanceOnEnter } from '../../utils/formFlow.js';

const initial = {
  date: new Date().toISOString().slice(0, 10),
  materialName: '',
  category: '',
  brand: '',
  quantity: '',
  unit: '',
  purchaseRate: '',
  supplier: '',
  remarks: '',
  openingStock: '',
  reorderLevel: '',
  paymentMode: 'Cash',
  upiRefNumber: '',
};

export default function MaterialEntryForm({ onSaved }) {
  const { t } = useLanguage();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Category/unit suggestions come from the Superadmin-managed Settings list
  // (datalist, not a locked dropdown) so staff can still type a one-off value
  // that isn't in the list yet, without needing an admin to add it first.
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [unitOptions, setUnitOptions] = useState([]);
  const [brandOptions, setBrandOptions] = useState([]);
  // Item O: the material names already on file, so the same material is picked
  // rather than retyped (and misspelled) each time.
  const [materialNameOptions, setMaterialNameOptions] = useState([]);

  useEffect(() => {
    settingsApi
      .get()
      .then((res) => {
        setCategoryOptions(res.data.materialCategories || []);
        setUnitOptions(res.data.materialUnits || []);
        // Brand suggestions: most-recently-used-first, computed from the
        // existing Material list, with any configured brand that hasn't been
        // used yet appended at the end in its configured order.
        const configuredBrands = res.data.materialBrands || [];
        materialApi
          .list()
          .then((matRes) => {
            const materials = (matRes.data || [])
              .slice()
              .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            const recentFirst = [];
            materials.forEach((m) => {
              if (m.brand && !recentFirst.includes(m.brand)) recentFirst.push(m.brand);
            });
            const rest = configuredBrands.filter((b) => !recentFirst.includes(b));
            setBrandOptions([...recentFirst, ...rest]);
            const names = [];
            materials.forEach((m) => {
              if (m.materialName && !names.includes(m.materialName)) names.push(m.materialName);
            });
            setMaterialNameOptions(names);
          })
          .catch(() => setBrandOptions(configuredBrands));
      })
      .catch(() => {
        /* datalist suggestions are a nice-to-have - free-text entry still works without them */
      });
  }, []);

  const amount = (Number(form.quantity) || 0) * (Number(form.purchaseRate) || 0);

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.materialName || !form.unit || !form.quantity || form.purchaseRate === '') {
      setError(t('materials.errorRequired'));
      return;
    }
    setSaving(true);
    try {
      await materialApi.create({
        ...form,
        quantity: Number(form.quantity),
        purchaseRate: Number(form.purchaseRate),
        openingStock: form.openingStock ? Number(form.openingStock) : 0,
        reorderLevel: form.reorderLevel ? Number(form.reorderLevel) : 0,
        upiRefNumber: form.paymentMode === 'GPay/UPI' ? form.upiRefNumber : '',
      });
      setForm(initial);
      onSaved?.();
    } catch (err) {
      setError(err.response?.data?.message || t('materials.errorSave'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="panel form" onSubmit={handleSubmit} onKeyDown={advanceOnEnter}>
      <h2>{t('materials.createEntry')}</h2>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="form-grid">
        <div className="form-field">
          <label>{t('materials.date')}</label>
          <DateField value={form.date} onChange={(e) => update('date', e.target.value)} required />
        </div>
        <div className="form-field">
          <label htmlFor="material-name">{t('materials.materialName')}</label>
          <SelectField
            id="material-name"
            searchable
            allowCustom
            placeholder="Cement, Steel, Sand..."
            value={form.materialName}
            onChange={(e) => update('materialName', e.target.value)}
            options={materialNameOptions.map((m) => ({ value: m, label: m }))}
          />
        </div>
        <div className="form-field">
          <label htmlFor="material-category">{t('materials.category')}</label>
          <SelectField
            id="material-category"
            searchable
            allowCustom
            allowClear
            clearLabel="Clear"
            placeholder="General, Structural..."
            value={form.category}
            onChange={(e) => update('category', e.target.value)}
            options={categoryOptions.map((c) => ({ value: c, label: c }))}
          />
        </div>
        <div className="form-field">
          <label htmlFor="material-brand">{t('materials.brand')}</label>
          <SelectField
            id="material-brand"
            searchable
            allowCustom
            allowClear
            clearLabel="Clear"
            placeholder="UltraTech, ACC, Tata..."
            value={form.brand}
            onChange={(e) => update('brand', e.target.value)}
            options={brandOptions.map((b) => ({ value: b, label: b }))}
          />
        </div>
        <div className="form-field">
          <label>{t('materials.quantity')}</label>
          <input type="number" min="0" step="0.01" value={form.quantity} onChange={(e) => update('quantity', e.target.value)} required />
        </div>
        <div className="form-field">
          <label>{t('materials.unit')}</label>
          <input
            placeholder="Bags, Tons, Nos, Ft..."
            value={form.unit}
            onChange={(e) => update('unit', e.target.value)}
            list="material-unit-options"
            required
          />
          <datalist id="material-unit-options">
            {unitOptions.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>
        <div className="form-field">
          <label>{t('materials.purchaseRate')}</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.purchaseRate}
            onChange={(e) => update('purchaseRate', e.target.value)}
            required
          />
        </div>
        <div className="form-field">
          <label>{t('materials.supplier')}</label>
          <input value={form.supplier} onChange={(e) => update('supplier', e.target.value)} />
        </div>
        <div className="form-field">
          <label>{t('voucher.paymentMode')}</label>
          <SelectField
            value={form.paymentMode}
            onChange={(e) => update('paymentMode', e.target.value)}
            options={[
                { value: 'Cash', label: 'Cash' },
                { value: 'GPay/UPI', label: 'GPay/UPI' },
                { value: 'IMPS', label: 'IMPS' },
                { value: 'RTGS', label: 'RTGS' },
                { value: 'NEFT', label: 'NEFT' },
              ]}
          />
        </div>
        {form.paymentMode === 'GPay/UPI' && (
          <div className="form-field">
            <label>{t('voucher.upiRefNumber')}</label>
            <input value={form.upiRefNumber} onChange={(e) => update('upiRefNumber', e.target.value)} />
          </div>
        )}
        <div className="form-field">
          <label>{t('materials.openingStock')}</label>
          <input type="number" min="0" value={form.openingStock} onChange={(e) => update('openingStock', e.target.value)} />
        </div>
        <div className="form-field">
          <label>{t('materials.reorderLevel')}</label>
          <input type="number" min="0" value={form.reorderLevel} onChange={(e) => update('reorderLevel', e.target.value)} />
        </div>
        <div className="form-field form-field-wide">
          <label>{t('materials.remarks')}</label>
          <input value={form.remarks} onChange={(e) => update('remarks', e.target.value)} />
        </div>
      </div>
      <div className="amount-display">
        {t('materials.totalAmountFormula')} <strong>{formatCurrency(amount)}</strong>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? t('materials.saving') : t('materials.save')}
        </button>
      </div>
    </form>
  );
}
