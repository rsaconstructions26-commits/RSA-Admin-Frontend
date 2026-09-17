import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { stockApi, moduleApi } from '../../api';
import MaterialEntryForm from './MaterialEntryForm.jsx';
import OpeningBalanceForm from './OpeningBalanceForm.jsx';
import ClosingBalanceForm from './ClosingBalanceForm.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { useLanguage } from '../../context/LanguageContext.jsx';
import BackButton from '../common/BackButton.jsx';
import StatCard from '../common/StatCard.jsx';
import SearchBox, { useSearch } from '../common/SearchBox.jsx';

/**
 * The "manual ledger style" table (per spec MATERIAL TABLE columns:
 * S.No, Date, Material Name, Quantity, Rate, Amount, Stock Balance, Remarks).
 * One row per stock movement, chronological, running balance - same shape as
 * the handwritten purchase ledger book.
 */
export default function MaterialLedger() {
  const { t } = useLanguage();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Opens showing the ledger table first (FR-08) - the entry form only
  // appears once the user explicitly taps "+ New Material Entry".
  // Items N and P: the three cramped actions in the header became one row of
  // equal-sized tabs, and each one now opens its own view instead of stacking
  // more content onto an already busy page. In particular the Purchase Ledger
  // table no longer renders unconditionally underneath everything else - it
  // is a tab you choose, which is what the client asked for.
  //   'summary' - landing view: totals only, nothing heavy
  //   'entry'   - the New Material Entry form on its own
  //   'ledger'  - the full purchase ledger table
  const [view, setView] = useState('summary');
  const showForm = view === 'entry';
  // Item 9 (2026-09-15): New Material Entry now has two extra sub-tabs -
  // Opening Balance and Closing Balance - alongside the original entry form.
  const [entrySubTab, setEntrySubTab] = useState('new');
  // Outsourcing Material / Client Material are Superadmin-created custom
  // modules, not built-in routes - fetched here (same list Layout.jsx's
  // sidebar uses) so this header row stays correct if their path/label ever
  // changes in the Superadmin Portal instead of hardcoding /outsourcing-material.
  const [quickLinks, setQuickLinks] = useState([]);
  useEffect(() => {
    moduleApi
      .list()
      .then((res) => {
        const wanted = ['Outsourcing Material', 'Client Material'];
        setQuickLinks(
          (res.data || [])
            .filter((m) => wanted.includes(m.label) && m.isActive)
            .sort((a, b) => wanted.indexOf(a.label) - wanted.indexOf(b.label))
        );
      })
      .catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    stockApi
      .ledger()
      .then((res) => setRows(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load material ledger'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const grandTotal = rows.reduce((s, r) => s + r.amount, 0);
  // "Only print the purchase list" - the on-screen ledger shows every stock
  // movement (purchases AND deliveries/usage) for full visibility, but the
  // printed page should read like the physical purchase ledger book: incoming
  // purchases only, nothing about where material was later used.
  const purchaseRows = rows.filter((r) => r.referenceType === 'Purchase' || r.type === 'IN');
  const purchaseTotal = purchaseRows.reduce((s, r) => s + r.amount, 0);

  // Item 13: search bar for the ledger table (client-side, no backend change).
  const [ledgerQuery, setLedgerQuery, filteredRows] = useSearch(rows, [
    'materialName',
    'brand',
    'type',
    'remarks',
    'reference',
    'paymentMode',
  ]);

  // "Print Purchases Only" used to call window.print() straight away, so an
  // empty ledger printed a blank sheet and every on-screen control came along
  // with it. Nothing goes to the printer unless there is something to print.
  const [printNotice, setPrintNotice] = useState('');
  const handlePrintPurchases = () => {
    if (!purchaseRows.length) {
      setPrintNotice('There are no purchase entries yet, so there is nothing to print.');
      return;
    }
    window.print();
  };

  // Delete a ledger row. The server undoes the row's effect on the material's
  // running totals and replays the balances below it, so Stock Balances and
  // the dashboard counts follow along instead of drifting.
  const [deletingId, setDeletingId] = useState(null);
  const [confirmRow, setConfirmRow] = useState(null);
  const doDelete = async (row) => {
    setConfirmRow(null);
    setDeletingId(row.id);
    setError('');
    try {
      await stockApi.deleteLedgerEntry(row.id);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not delete this ledger entry.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      {confirmRow && (
        <div className="modal-overlay no-print" onClick={() => setConfirmRow(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Delete this entry?</h3>
            <p style={{ margin: '8px 0 0', fontSize: '13.5px' }}>
              {confirmRow.materialName} - {confirmRow.type} {confirmRow.quantity} {confirmRow.unit}
              {confirmRow.rate ? ` at ${formatCurrency(confirmRow.rate)}` : ''}. The material's stock balance will be
              adjusted to match. This cannot be undone.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmRow(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={() => doDelete(confirmRow)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {printNotice && (
        <div className="modal-overlay no-print" onClick={() => setPrintNotice('')}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Nothing to print</h3>
            <p style={{ margin: '8px 0 0', fontSize: '13.5px' }}>{printNotice}</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setPrintNotice('')}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <h1 className="page-title">{t('materials.title')}</h1>
        <div className="row-actions">
          <BackButton />
        </div>
      </div>

      {/* Item N: uniform, finger-sized tabs instead of three differently
          sized buttons crowded into the header. */}
      <div className="rsa-tabbar" role="tablist" aria-label="Material stock sections">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'summary'}
          className={`rsa-tab${view === 'summary' ? ' is-active' : ''}`}
          onClick={() => setView('summary')}
        >
          {t('materials.title')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'entry'}
          className={`rsa-tab${view === 'entry' ? ' is-active' : ''}`}
          onClick={() => setView('entry')}
        >
          {t('materials.newEntry')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'ledger'}
          className={`rsa-tab${view === 'ledger' ? ' is-active' : ''}`}
          onClick={() => setView('ledger')}
        >
          {t('materials.ledgerTitle')}
        </button>
        <Link to="/stock" className="rsa-tab" role="tab">
          {t('materials.stockBalances')}
        </Link>
        {quickLinks.map((m) => (
          <Link key={m.path} to={m.path} className="rsa-tab" role="tab">
            {m.label}
          </Link>
        ))}
        <button type="button" className="rsa-tab" onClick={handlePrintPurchases}>
          {t('materials.printPurchasesOnly')}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {showForm && (
        <div>
          <div className="rsa-tabbar rsa-tabbar-sub no-print" role="tablist" aria-label="New Material Entry sections">
            <button
              type="button"
              role="tab"
              aria-selected={entrySubTab === 'new'}
              className={`rsa-tab${entrySubTab === 'new' ? ' is-active' : ''}`}
              onClick={() => setEntrySubTab('new')}
            >
              New Entry
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={entrySubTab === 'opening'}
              className={`rsa-tab${entrySubTab === 'opening' ? ' is-active' : ''}`}
              onClick={() => setEntrySubTab('opening')}
            >
              Opening Balance
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={entrySubTab === 'closing'}
              className={`rsa-tab${entrySubTab === 'closing' ? ' is-active' : ''}`}
              onClick={() => setEntrySubTab('closing')}
            >
              Closing Balance
            </button>
          </div>
          {entrySubTab === 'new' && <MaterialEntryForm onSaved={() => { load(); setView('ledger'); }} />}
          {entrySubTab === 'opening' && <OpeningBalanceForm onSaved={load} />}
          {entrySubTab === 'closing' && <ClosingBalanceForm onSaved={load} />}
        </div>
      )}

      {view === 'summary' && (
        <div className="panel">
          <h2 className="ledger-title">{t('materials.title')}</h2>
          <div className="stat-grid">
            <StatCard label={t('materials.totalLabel')} value={formatCurrency(grandTotal)} />
            <StatCard label={t('materials.purchaseListTitle')} value={formatCurrency(purchaseTotal)} />
            <StatCard label={t('materials.sNo')} value={rows.length} />
          </div>
          <p className="field-hint">Choose a tab above to add an entry or open the purchase ledger.</p>
        </div>
      )}

      {/* Full ledger (all movements) - only when its tab is selected (item P),
          and hidden when printing (the print-only purchase sheet below is
          what actually goes to paper). */}
      <div className="panel screen-only-ledger" hidden={view !== 'ledger'}>
        <div className="panel-header-row">
          <h2 className="ledger-title">{t('materials.ledgerTitle')}</h2>
          <SearchBox value={ledgerQuery} onChange={setLedgerQuery} placeholder="Search ledger..." />
        </div>
        {loading ? (
          <div className="page-loading">{t('billing.loading')}</div>
        ) : (
          <div className="table-scroll">
          <table className="data-table ledger-table stack-on-mobile">
            <thead>
              <tr>
                <th>{t('materials.sNo')}</th>
                <th>{t('materials.date')}</th>
                <th>{t('materials.materialName')}</th>
                <th>{t('materials.brand')}</th>
                <th>{t('materials.type')}</th>
                <th>{t('materials.quantity')}</th>
                <th>{t('materials.purchaseRate')}</th>
                <th>{t('deliveryForm.colAmount')}</th>
                <th>{t('voucher.paymentMode')}</th>
                <th>{t('materials.stockBalance')}</th>
                <th>{t('materials.remarks')}</th>
                {/* Item 10 (2026-09-15): who logged this row - Admin shows as
                    "Owner", Manager as "Manager". */}
                <th>Purchaser</th>
                <th className="no-print">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id}>
                  <td data-label={t('materials.sNo')}>{r.sNo}</td>
                  <td data-label={t('materials.date')}>{formatDate(r.date)}</td>
                  <td data-label={t('materials.materialName')}>{r.materialName}</td>
                  <td data-label={t('materials.brand')}>{r.brand || ''}</td>
                  <td className={r.type === 'IN' ? 'txn-in' : 'txn-out'} data-label={t('materials.type')}>{r.type}</td>
                  <td data-label={t('materials.quantity')}>
                    {r.quantity} {r.unit}
                  </td>
                  <td className="amount-cell" data-label={t('materials.purchaseRate')}>{formatCurrency(r.rate)}</td>
                  <td className="amount-cell" data-label={t('deliveryForm.colAmount')}>{formatCurrency(r.amount)}</td>
                  <td data-label={t('voucher.paymentMode')}>
                    {r.paymentMode
                      ? `${r.paymentMode}${r.paymentMode === 'GPay/UPI' && r.upiRefNumber ? ` (${r.upiRefNumber})` : ''}`
                      : ''}
                  </td>
                  <td data-label={t('materials.stockBalance')}>
                    {r.stockBalance} {r.unit}
                  </td>
                  <td data-label={t('materials.remarks')}>{r.remarks || r.reference}</td>
                  <td data-label="Purchaser">
                    {r.purchasedByRole === 'admin' ? 'Owner' : r.purchasedByRole === 'manager' ? 'Manager' : '-'}
                  </td>
                  <td className="no-print" data-label="Actions">
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={deletingId === r.id}
                      onClick={() => setConfirmRow(r)}
                      title={
                        r.referenceType === 'DeliveryNote'
                          ? 'Created by a delivery note - delete it from the note instead'
                          : 'Delete this ledger entry'
                      }
                    >
                      {deletingId === r.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={13} className="empty-row">
                    {rows.length === 0 ? t('materials.noEntries') : 'No entries match your search.'}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7} className="total-label">
                  {t('materials.totalLabel')}
                </td>
                <td className="amount-cell total-amount">{formatCurrency(grandTotal)}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
          </div>
        )}
      </div>

      {/* Purchase-only sheet - hidden on screen, this is what actually prints */}
      <div className="panel print-only-ledger ledger-print-area">
        <h2 className="ledger-title">{t('materials.purchaseListTitle')}</h2>
        <div className="table-scroll">
        <table className="data-table ledger-table">
          <thead>
            <tr>
              <th>{t('materials.sNo')}</th>
              <th>{t('materials.date')}</th>
              <th>{t('materials.materialName')}</th>
              <th>{t('materials.brand')}</th>
              <th>{t('materials.quantity')}</th>
              <th>{t('materials.purchaseRate')}</th>
              <th>{t('deliveryForm.colAmount')}</th>
            </tr>
          </thead>
          <tbody>
            {purchaseRows.map((r) => (
              <tr key={r.id}>
                <td>{r.sNo}</td>
                <td>{formatDate(r.date)}</td>
                <td>{r.materialName}</td>
                <td>{r.brand || ''}</td>
                <td>
                  {r.quantity} {r.unit}
                </td>
                <td className="amount-cell">{formatCurrency(r.rate)}</td>
                <td className="amount-cell">{formatCurrency(r.amount)}</td>
              </tr>
            ))}
            {purchaseRows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-row">
                  {t('materials.noEntries')}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6} className="total-label">
                {t('materials.totalLabel')}
              </td>
              <td className="amount-cell total-amount">{formatCurrency(purchaseTotal)}</td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>
    </div>
  );
}
