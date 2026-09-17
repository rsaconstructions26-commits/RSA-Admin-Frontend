import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { reportApi, settingsApi, labourApi } from '../../api';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { useLanguage } from '../../context/LanguageContext.jsx';
import BackButton from '../common/BackButton.jsx';
import DateField from '../common/DateField.jsx';
import SelectField from '../common/SelectField.jsx';
import SearchBox, { useSearch } from '../common/SearchBox.jsx';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function downloadWorkbook(sheets, filename) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, rows }) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, filename);
}

export default function Reports() {
  const { t } = useLanguage();
  const [tab, setTab] = useState('daily');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [daily, setDaily] = useState(null);
  const [monthly, setMonthly] = useState(null);
  const [yearly, setYearly] = useState(null);
  const [error, setError] = useState('');

  // Item 13: search across the material-cost rows on the monthly tab.
  const monthlyCostRows = monthly ? Object.entries(monthly.cost.byMaterial).map(([name, cost]) => ({ name, cost })) : [];
  const [monthlyQuery, setMonthlyQuery, filteredMonthlyCostRows] = useSearch(monthlyCostRows, ['name']);

  // Item 13: search across the by-month rows on the yearly tab.
  const yearlyMonthRows = yearly ? MONTH_NAMES.map((m, idx) => ({ month: m, revenue: yearly.byMonth[idx] })) : [];
  const [yearlyQuery, setYearlyQuery, filteredYearlyMonthRows] = useSearch(yearlyMonthRows, ['month']);

  // Item 2 (2026-09-15): "Clients" is no longer a tab inside Reports - it now
  // has its own sidebar link (see components/Clients/ClientsPage.jsx and
  // Layout.jsx), right below Reports, matching where the reference screenshot
  // showed it.

  const loadDaily = async () => {
    setError('');
    try {
      const [billing, movement] = await Promise.all([
        reportApi.dailyBilling(date),
        reportApi.dailyMaterialMovement(date),
      ]);
      setDaily({ billing: billing.data, movement: movement.data });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load daily report');
    }
  };

  const loadMonthly = async () => {
    setError('');
    try {
      const [revenue, cost] = await Promise.all([
        reportApi.monthlyRevenue(year, month),
        reportApi.monthlyMaterialCost(year, month),
      ]);
      setMonthly({ revenue: revenue.data, cost: cost.data });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load monthly report');
    }
  };

  const loadYearly = async () => {
    setError('');
    try {
      const res = await reportApi.yearlySummary(year);
      setYearly(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load yearly report');
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('reports.title')}</h1>
        <BackButton />
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="report-tabs">
        <button className={`tab-link${tab === 'daily' ? ' active' : ''}`} onClick={() => setTab('daily')}>
          {t('reports.daily')}
        </button>
        <button className={`tab-link${tab === 'monthly' ? ' active' : ''}`} onClick={() => setTab('monthly')}>
          {t('reports.monthly')}
        </button>
        <button className={`tab-link${tab === 'yearly' ? ' active' : ''}`} onClick={() => setTab('yearly')}>
          {t('reports.yearly')}
        </button>
      </div>

      {tab === 'daily' && (
        <div className="panel">
          <div className="toolbar report-run-row">
            <DateField value={date} onChange={(e) => setDate(e.target.value)} />
            <button className="btn btn-primary" onClick={loadDaily}>
              {t('reports.runDaily')}
            </button>
            {daily && (
              <button
                className="btn btn-ghost"
                onClick={() =>
                  downloadWorkbook(
                    [
                      {
                        name: 'Billing',
                        rows: daily.billing.notes.map((n) => ({
                          NoteNo: n.noteNumber,
                          Customer: n.customerNameSnapshot,
                          Total: n.totalAmount,
                          Status: n.paymentStatus,
                        })),
                      },
                      {
                        name: 'Material Movement',
                        rows: daily.movement.transactions.map((tr) => ({
                          Material: tr.materialId?.materialName,
                          Type: tr.type,
                          Quantity: tr.quantity,
                          Reference: tr.reference,
                        })),
                      },
                    ],
                    `daily-report-${date}.xlsx`
                  )
                }
              >
                {t('reports.exportExcel')}
              </button>
            )}
          </div>
          {daily && (
            <>
              <h2>
                {t('reports.billingReport')} - {formatDate(daily.billing.date)}
              </h2>
              <p>
                {daily.billing.count} delivery notes, total {formatCurrency(daily.billing.total)}
              </p>
              <h2>{t('reports.materialMovement')}</h2>
              <p>{daily.movement.count} stock transactions</p>
            </>
          )}
        </div>
      )}

      {tab === 'monthly' && (
        <div className="panel">
          <div className="toolbar report-run-row">
            <SelectField
              aria-label="Month"
              value={String(month)}
              onChange={(e) => setMonth(Number(e.target.value))}
              options={MONTH_NAMES.map((m, idx) => ({ value: String(idx + 1), label: m }))}
            />
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 100 }} />
            <button className="btn btn-primary" onClick={loadMonthly}>
              {t('reports.runMonthly')}
            </button>
            {monthly && (
              <button
                className="btn btn-ghost"
                onClick={() =>
                  downloadWorkbook(
                    [
                      {
                        name: 'Revenue',
                        rows: [
                          { Metric: 'Total', Value: monthly.revenue.total },
                          { Metric: 'Paid', Value: monthly.revenue.paid },
                          { Metric: 'Pending', Value: monthly.revenue.pending },
                        ],
                      },
                      {
                        name: 'Material Cost',
                        rows: Object.entries(monthly.cost.byMaterial).map(([k, v]) => ({ Material: k, Cost: v })),
                      },
                    ],
                    `monthly-report-${year}-${month}.xlsx`
                  )
                }
              >
                {t('reports.exportExcel')}
              </button>
            )}
          </div>
          {monthly && (
            <>
              <h2>
                {t('reports.revenueReport')} - {MONTH_NAMES[month - 1]} {year}
              </h2>
              <div className="stat-grid">
                <div className="stat-card">
                  <div className="stat-label">{t('reports.totalRevenue')}</div>
                  <div className="stat-value">{formatCurrency(monthly.revenue.total)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">{t('reports.paid')}</div>
                  <div className="stat-value">{formatCurrency(monthly.revenue.paid)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">{t('reports.pendingAmt')}</div>
                  <div className="stat-value">{formatCurrency(monthly.revenue.pending)}</div>
                </div>
              </div>
              <div className="panel-header-row">
                <h2>{t('reports.materialCostReport')}</h2>
                <SearchBox value={monthlyQuery} onChange={setMonthlyQuery} placeholder="Search materials..." />
              </div>
              <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('reports.material')}</th>
                    <th className="amount-cell">{t('reports.cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMonthlyCostRows.map(({ name, cost }) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="amount-cell">{formatCurrency(cost)}</td>
                    </tr>
                  ))}
                  {filteredMonthlyCostRows.length === 0 && (
                    <tr>
                      <td colSpan={2} className="empty-row">
                        No materials match your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'yearly' && (
        <div className="panel">
          <div className="toolbar report-run-row">
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 100 }} />
            <button className="btn btn-primary" onClick={loadYearly}>
              {t('reports.runYearly')}
            </button>
            {yearly && (
              <button
                className="btn btn-ghost"
                onClick={() =>
                  downloadWorkbook(
                    [
                      {
                        name: 'Yearly Summary',
                        rows: MONTH_NAMES.map((m, idx) => ({ Month: m, Revenue: yearly.byMonth[idx] })),
                      },
                    ],
                    `yearly-summary-${year}.xlsx`
                  )
                }
              >
                {t('reports.exportExcel')}
              </button>
            )}
          </div>
          {yearly && (
            <>
              <h2>
                {t('reports.businessSummary')} - {yearly.year}
              </h2>
              <div className="stat-grid">
                <div className="stat-card">
                  <div className="stat-label">{t('reports.totalRevenue')}</div>
                  <div className="stat-value">{formatCurrency(yearly.totalRevenue)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">{t('reports.deliveryNotes')}</div>
                  <div className="stat-value">{yearly.totalDeliveryNotes}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">{t('reports.materialSpend')}</div>
                  <div className="stat-value">{formatCurrency(yearly.materialSpend)}</div>
                </div>
              </div>
              <div className="panel-header-row">
                <SearchBox value={yearlyQuery} onChange={setYearlyQuery} placeholder="Search months..." />
              </div>
              <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('reports.month')}</th>
                    <th className="amount-cell">{t('reports.revenue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredYearlyMonthRows.map(({ month, revenue }) => (
                    <tr key={month}>
                      <td>{month}</td>
                      <td className="amount-cell">{formatCurrency(revenue)}</td>
                    </tr>
                  ))}
                  {filteredYearlyMonthRows.length === 0 && (
                    <tr>
                      <td colSpan={2} className="empty-row">
                        No months match your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </>
          )}
        </div>
      )}

    </div>
  );
}
