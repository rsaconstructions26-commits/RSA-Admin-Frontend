import React, { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { workerApi, labourApi, settingsApi } from '../../api';
import SearchBox, { useSearch } from '../common/SearchBox.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { useLanguage } from '../../context/LanguageContext.jsx';
import BackButton from '../common/BackButton.jsx';
import LoadingState from '../common/LoadingState.jsx';
import SelectField from '../common/SelectField.jsx';
import DateField from '../common/DateField.jsx';
import { advanceOnEnter } from '../../utils/formFlow.js';

// Item 6 (2026-09-15): the standalone "Helpers" tab has been removed
// entirely - a helper is still recorded (as a Worker with role "Helper"
// linked via underWorker), just through the "Helper Name" field on the
// Workers tab's Add Worker form, so there is no separate tab to manage them
// in any more.
const TABS = [
  { key: 'workers', labelKey: 'labour.tabWorkers' },
  { key: 'entry', labelKey: 'labour.tabEntry' },
  { key: 'site', labelKey: 'labour.tabSiteSheet' },
  { key: 'consolidated', labelKey: 'labour.tabConsolidated' },
  { key: 'monthlySalary', labelKey: 'labour.tabMonthlySalary' },
];

// Shared by SiteSheetTab/ConsolidatedTab's "Share via WhatsApp" buttons -
// same html2canvas -> jsPDF -> Web Share pattern as DeliveryNotePrint.jsx
// and VoucherPrint.jsx, just factored into one helper since both call sites
// live in this same file.
const round2Local = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function generateSheetPdfBlob(sheetRef) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const canvas = await html2canvas(sheetRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
  const imgData = canvas.toDataURL('image/jpeg', 0.95);
  const imgHeight = (canvas.height * pageWidth) / canvas.width;
  pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, Math.min(imgHeight, pageHeight));
  return pdf.output('blob');
}

async function shareSheetViaWhatsApp({ sheetRef, fileName, message, setSharing, setError }) {
  setError('');
  setSharing(true);
  try {
    const blob = await generateSheetPdfBlob(sheetRef);
    const file = new File([blob], fileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: fileName, text: message });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    window.open(
      `https://wa.me/?text=${encodeURIComponent(message + '\n\n(PDF downloaded - please attach it here)')}`,
      '_blank'
    );
  } catch (err) {
    if (err?.name !== 'AbortError') setError('Could not prepare the PDF to share. Please try Print instead.');
  } finally {
    setSharing(false);
  }
}

/**
 * Labour / payroll module ("Labour ku Vouchers.. daily sheet: site name,
 * workername, mason - members how many, salary, old balance, advance,
 * total, paid"). Four views sharing one worker/site data model:
 *  - Daily Entry: post today's wage/advance/paid for a worker
 *  - Workers: master list (like the Material master) with running balance
 *  - Site Sheet: one site's register + totals ("10 sites - individual sheet")
 *  - All Sites: every site rolled up side by side ("common sheet")
 */
export default function LabourPage() {
  const { t } = useLanguage();
  // Printing changes the viewport, which fires the media-query listeners in
  // ViewportContext and can remount this page - which used to drop you back
  // on the first tab the moment you cancelled the print dialog. Remembering
  // the tab for the session keeps you where you were.
  const [activeTab, setActiveTabState] = useState(() => {
    try {
      return sessionStorage.getItem('rsa_labour_tab') || 'workers';
    } catch {
      return 'workers';
    }
  });
  const setActiveTab = (tab) => {
    try {
      sessionStorage.setItem('rsa_labour_tab', tab);
    } catch {
      /* private mode - the tab just won't persist */
    }
    setActiveTabState(tab);
  };
  const [sites, setSites] = useState([]);
  const [roles, setRoles] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loadingWorkers, setLoadingWorkers] = useState(true);
  const [workersError, setWorkersError] = useState('');

  const reloadWorkers = () => {
    setLoadingWorkers(true);
    setWorkersError('');
    workerApi
      .list()
      .then((res) => setWorkers(res.data))
      .catch((err) => setWorkersError(err.response?.data?.message || 'Failed to load workers - the server may be slow to respond.'))
      .finally(() => setLoadingWorkers(false));
  };

  useEffect(() => {
    settingsApi
      .get()
      .then((res) => {
        setSites(res.data.sites || []);
        // "Vendor" was removed from the Role dropdown per founder direction -
        // filtered here as well as in the seed data, so it disappears even
        // for installs whose Settings document was seeded before this change.
        setRoles((res.data.workerRoles || []).filter((r) => r.trim().toLowerCase() !== 'vendor'));
      })
      .catch(() => {});
    reloadWorkers();
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('labour.title')}</h1>
        <BackButton />
      </div>

      <div className="report-tabs no-print">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab-link${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {activeTab === 'entry' && (
        <DailyEntryTab workers={workers} loadingWorkers={loadingWorkers} sites={sites} onPosted={reloadWorkers} t={t} />
      )}
      {/* Workers tab = Add Worker + the Workers list, nothing else. Daily
          Entry / Site Progress live under their own tab, which is where the
          duplicate copy that used to be stacked here has gone. */}
      {activeTab === 'workers' && (
        <WorkersTab
          workers={workers}
          loadingWorkers={loadingWorkers}
          workersError={workersError}
          sites={sites}
          roles={roles}
          onChange={reloadWorkers}
          t={t}
        />
      )}
      {activeTab === 'site' && (
        <SiteSheetTab
          sites={sites}
          onSiteAdded={(name) => setSites((prev) => (prev.includes(name) ? prev : [...prev, name]))}
          t={t}
        />
      )}
      {activeTab === 'consolidated' && <ConsolidatedTab t={t} />}
      {activeTab === 'monthlySalary' && <MonthlySalaryTab t={t} />}
    </div>
  );
}

function DailyEntryTab({ workers, loadingWorkers, sites, onPosted, t }) {
  const activeWorkers = useMemo(() => workers.filter((w) => w.active), [workers]);
  const [workerId, setWorkerId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [daysWorked, setDaysWorked] = useState('1');
  // Item 7 (2026-09-15): a dedicated "Daily Wage" box that fills itself in
  // the moment a worker is picked (from that worker's saved rate), but stays
  // editable in case that one day's rate needs a one-off adjustment.
  const [dailyWageInput, setDailyWageInput] = useState('');
  const [advance, setAdvance] = useState('');
  const [paid, setPaid] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [recentEntries, setRecentEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [entriesError, setEntriesError] = useState('');
  const recentEntriesRef = useRef(null);
  const [sharingEntries, setSharingEntries] = useState(false);
  const [shareError, setShareError] = useState('');

  // Site progress: one photo set + GPS location per site/day (item 7).
  const [logSite, setLogSite] = useState('');
  const [logDate, setLogDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logFiles, setLogFiles] = useState([]);
  const [logLocation, setLogLocation] = useState(null);
  const [logNote, setLogNote] = useState('');
  const [locating, setLocating] = useState(false);
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [logError, setLogError] = useState('');
  const [logNotice, setLogNotice] = useState('');
  const [uploadingLog, setUploadingLog] = useState(false);

  // Nominatim (OpenStreetMap) - free, no API key, but rate-limited to ~1
  // request/sec and asks callers to identify themselves; the browser's Referer
  // header (sent automatically) serves that purpose for client-side calls
  // like this one. If it's unreachable or returns nothing, the caller just
  // keeps showing the raw coordinates - never blocks capture on this.
  const reverseGeocode = async (lat, lng) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=0`,
        { headers: { Accept: 'application/json' } }
      );
      if (!res.ok) return '';
      const data = await res.json();
      return data?.display_name || '';
    } catch {
      return '';
    }
  };

  const captureLocation = () => {
    if (!navigator.geolocation) {
      setLogError('Location is not available on this device/browser.');
      return;
    }
    setLogError('');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy; // meters
        setLogLocation({ lat, lng, address: '', accuracy });
        setLocating(false);
        setResolvingAddress(true);
        reverseGeocode(lat, lng)
          .then((address) => setLogLocation({ lat, lng, address, accuracy }))
          .finally(() => setResolvingAddress(false));
      },
      (err) => {
        setLogError(err.message || 'Could not get location');
        setLocating(false);
      },
      // maximumAge: 0 forces a fresh fix instead of a cached one - a stale
      // cached position is exactly what makes a "Re-capture" from a different
      // site look like it silently didn't do anything.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleLogFilesChange = (e) => {
    setLogFiles(Array.from(e.target.files || []));
  };

  const submitSiteLog = async () => {
    setLogError('');
    setLogNotice('');
    if (!logSite) {
      setLogError('Select a site first');
      return;
    }
    if (logFiles.length < 2) {
      setLogError('Choose at least 2 photos');
      return;
    }
    setUploadingLog(true);
    try {
      await labourApi.uploadSiteLogPhotos(logSite, logDate, logFiles, logLocation, logNote);
      setLogFiles([]);
      setLogNote('');
      setLogNotice('Site progress saved.');
    } catch (err) {
      setLogError(err.response?.data?.message || 'Failed to save site progress');
    } finally {
      setUploadingLog(false);
    }
  };

  const selectedWorker = activeWorkers.find((w) => w._id === workerId);
  // Fill the Daily Wage box the moment a different worker is selected, from
  // that worker's saved rate - still just a plain input the user can edit
  // afterwards for a one-off rate change on this entry only.
  useEffect(() => {
    setDailyWageInput(selectedWorker ? String(selectedWorker.dailyWage ?? '') : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerId]);

  // Item 12 (2026-09-15): every Helper is stored as a Worker record linked
  // to their worker via `underWorker` (set when the worker was added - see
  // the "Helper Name" field on Workers). Picking the worker here now shows
  // that linked helper automatically, for every worker that has one.
  const linkedHelpers = useMemo(
    () => (selectedWorker ? workers.filter((w) => w.role === 'Helper' && w.underWorker === selectedWorker.name) : []),
    [workers, selectedWorker]
  );
  const [helperId, setHelperId] = useState('');
  useEffect(() => {
    setHelperId(linkedHelpers[0]?._id || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerId]);
  const effectiveDailyWage = dailyWageInput === '' ? Number(selectedWorker?.dailyWage) || 0 : Number(dailyWageInput) || 0;
  const wageEarnedPreview = selectedWorker
    ? Math.round(effectiveDailyWage * (Number(daysWorked) || 0) * 100) / 100
    : 0;
  // "Daily Wages" breakdown panel: Total = Old Balance + (Daily Wage x Days
  // Worked), Balance = Total - Advance - Paid - exactly the same formula the
  // server applies when the entry is posted (labourController.createEntry),
  // shown here as a preview so staff can check the numbers before saving.
  // The resulting balance is what automatically becomes "Old Balance" the
  // next time an entry is posted for this worker - see worker.currentBalance
  // on the server, which this preview only reads, never recalculates itself.
  const [showWageBreakdown, setShowWageBreakdown] = useState(false);
  const oldBalancePreview = selectedWorker ? Number(selectedWorker.currentBalance) || 0 : 0;
  const totalPreview = round2Local(oldBalancePreview + wageEarnedPreview);
  const balancePreview = round2Local(totalPreview - (Number(advance) || 0) - (Number(paid) || 0));

  const loadRecent = () => {
    setLoadingEntries(true);
    setEntriesError('');
    labourApi
      .listEntries({ limit: 20 })
      .then((res) => setRecentEntries(res.data.slice(0, 20)))
      .catch((err) => setEntriesError(err.response?.data?.message || 'Failed to load entries - the server may be slow to respond.'))
      .finally(() => setLoadingEntries(false));
  };
  useEffect(loadRecent, []);

  // "No of person" = headcount, not a per-worker value - count of distinct
  // workers with an entry on this row's same site+day, computed from the
  // currently-loaded Recent Entries (same "how many people were on site"
  // idea as the Site Sheet/Consolidated headcount, applied per site/day
  // instead of "all active workers ever assigned to the site" - see final
  // report, this interpretation needs founder confirmation).
  const workerCountFor = (entry) => {
    const dayKey = new Date(entry.date).toDateString();
    const ids = new Set(
      recentEntries
        .filter((e) => e.site === entry.site && new Date(e.date).toDateString() === dayKey)
        .map((e) => e.workerId)
    );
    return ids.size;
  };

  const shareEntriesViaWhatsApp = () =>
    shareSheetViaWhatsApp({
      sheetRef: recentEntriesRef,
      fileName: 'Recent-Entries.pdf',
      message: `R.S.A Construction - Recent Labour Entries (${recentEntries.length} rows)`,
      setSharing: setSharingEntries,
      setError: setShareError,
    });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!workerId) {
      setError(t('labour.errorSelectWorker'));
      return;
    }
    setSaving(true);
    try {
      await labourApi.createEntry({
        workerId,
        date,
        daysWorked: Number(daysWorked) || 1,
        dailyWage: effectiveDailyWage,
        advance: Number(advance) || 0,
        paid: Number(paid) || 0,
        remarks,
      });
      setAdvance('');
      setPaid('');
      setRemarks('');
      loadRecent();
      onPosted();
    } catch (err) {
      setError(err.response?.data?.message || t('labour.errorSave'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <form className="panel form" onSubmit={handleSubmit} onKeyDown={advanceOnEnter}>
        <h2>{t('labour.tabEntry')}</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-grid">
          <div className="form-field">
            <label>{t('labour.selectWorker')}</label>
            <SelectField
              searchable
              required
              placeholder={t('labour.selectPlaceholder')}
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              options={activeWorkers.map((w) => ({
                value: w._id,
                label: `${w.name}${w.site ? ` (${w.site})` : ''}`,
              }))}
            />
          </div>
          <div className="form-field">
            <label>Helper Name</label>
            <SelectField
              searchable
              allowClear
              clearLabel="None"
              placeholder={selectedWorker ? 'No linked helper' : 'Select a worker first'}
              value={helperId}
              onChange={(e) => setHelperId(e.target.value)}
              options={linkedHelpers.map((h) => ({ value: h._id, label: h.name }))}
              disabled={!selectedWorker}
            />
          </div>
          <div className="form-field">
            <label>{t('labour.date')}</label>
            <DateField value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="form-field">
            <label>{t('labour.daysWorked')}</label>
            <input type="number" min="0" step="0.5" value={daysWorked} onChange={(e) => setDaysWorked(e.target.value)} />
          </div>
          <div className="form-field">
            <label>Daily Wage</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={dailyWageInput}
              onChange={(e) => setDailyWageInput(e.target.value)}
              placeholder={selectedWorker ? 'Auto-filled from worker' : 'Select a worker first'}
              disabled={!selectedWorker}
            />
          </div>
          <div className="form-field">
            <label>{t('labour.advance')}</label>
            <input type="number" min="0" step="0.01" value={advance} onChange={(e) => setAdvance(e.target.value)} />
          </div>
          <div className="form-field">
            <label>{t('labour.paid')}</label>
            <input type="number" min="0" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} />
          </div>
          <div className="form-field form-field-wide">
            <label>{t('labour.remarks')}</label>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>
        {selectedWorker && (
          <div className="amount-display">
            {t('labour.wageEarned')}: <strong>{formatCurrency(wageEarnedPreview)}</strong>
            {'  '}({t('labour.dailyWage')}: {formatCurrency(effectiveDailyWage)} × {daysWorked || 0})
          </div>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!selectedWorker}
            onClick={() => setShowWageBreakdown((v) => !v)}
          >
            {showWageBreakdown ? 'Hide' : ''} Daily Wages
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || loadingWorkers}>
            {saving ? t('labour.saving') : t('labour.postEntry')}
          </button>
        </div>

        {showWageBreakdown && selectedWorker && (
          <div className="wage-breakdown-panel">
            <div className="wage-breakdown-row">
              <span>Daily Wage</span>
              <strong>{formatCurrency(effectiveDailyWage)}</strong>
            </div>
            <div className="wage-breakdown-row">
              <span>Days Worked</span>
              <strong>{daysWorked || 0}</strong>
            </div>
            <div className="wage-breakdown-row">
              <span>Old Balance</span>
              <strong>{formatCurrency(oldBalancePreview)}</strong>
            </div>
            <div className="wage-breakdown-row wage-breakdown-total">
              <span>Total (Old Balance + Wage Earned)</span>
              <strong>{formatCurrency(totalPreview)}</strong>
            </div>
            <div className="wage-breakdown-row">
              <span>Advance</span>
              <strong>{formatCurrency(Number(advance) || 0)}</strong>
            </div>
            <div className="wage-breakdown-row">
              <span>Paid</span>
              <strong>{formatCurrency(Number(paid) || 0)}</strong>
            </div>
            <div className="wage-breakdown-row wage-breakdown-balance">
              <span>New Balance (carries into next entry)</span>
              <strong className={balancePreview > 0 ? 'danger-text' : ''}>{formatCurrency(balancePreview)}</strong>
            </div>
          </div>
        )}
      </form>

      <div className="panel">
        <h2>Site Progress Photos</h2>
        <p className="amount-display" style={{ marginTop: 0 }}>
          One photo set + location per site per day - re-saving the same site/date replaces the previous set.
        </p>
        {logError && <div className="alert alert-error">{logError}</div>}
        {logNotice && <div className="field-hint">{logNotice}</div>}
        <div className="form-grid">
          <div className="form-field">
            <label>{t('labour.site')}</label>
            <SelectField
              searchable
              placeholder={t('labour.selectPlaceholder')}
              value={logSite}
              onChange={(e) => setLogSite(e.target.value)}
              options={sites.map((s) => ({ value: s, label: s }))}
            />
          </div>
          <div className="form-field">
            <label>{t('labour.date')}</label>
            <DateField value={logDate} onChange={(e) => setLogDate(e.target.value)} />
          </div>
          <div className="form-field">
            <label>Photos (2-7)</label>
            <input type="file" accept="image/*" capture="environment" multiple onChange={handleLogFilesChange} />
            {logFiles.length > 0 && <span className="field-hint">{logFiles.length} photo(s) selected</span>}
          </div>
          <div className="form-field">
            <label>Location</label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={captureLocation} disabled={locating}>
              📍 {locating ? 'Locating...' : logLocation ? 'Re-capture Location' : 'Capture Location'}
            </button>
            {resolvingAddress && <span className="field-hint">Resolving address...</span>}
            {logLocation && !resolvingAddress && (
              <span className="field-hint">
                {logLocation.address ? (
                  <>
                    {logLocation.address}
                    <span className="stat-sub">
                      {' '}
                      ({logLocation.lat.toFixed(5)}, {logLocation.lng.toFixed(5)})
                    </span>
                  </>
                ) : (
                  `${logLocation.lat.toFixed(5)}, ${logLocation.lng.toFixed(5)}`
                )}
              </span>
            )}
            {/* A laptop/desktop browser has no GPS chip and falls back to
                Wi-Fi/IP-based positioning, which resolves to roughly the same
                spot (the ISP's registered location) regardless of which site
                is actually being logged from - this can only be fixed by
                using a phone with GPS outdoors, not by code, so the accuracy
                radius is surfaced here instead of silently trusting a bad
                fix. */}
            {logLocation?.accuracy > 100 && (
              <span className="field-hint field-hint-error">
                Location accuracy is low (±{Math.round(logLocation.accuracy)}m) - for a precise reading, use this on
                a phone with GPS/location enabled outdoors, then tap Re-capture Location.
              </span>
            )}
          </div>
          <div className="form-field form-field-wide">
            <label>Location note (optional)</label>
            <input
              value={logNote}
              onChange={(e) => setLogNote(e.target.value)}
              placeholder="e.g. Thanjavur Site, near the water tank"
            />
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-primary" disabled={uploadingLog} onClick={submitSiteLog}>
            {uploadingLog ? 'Saving...' : 'Save Site Progress'}
          </button>
        </div>
      </div>

      <div className="panel" ref={recentEntriesRef}>
        <h2>{t('labour.recentEntries')}</h2>
        <LoadingState loading={loadingEntries} error={entriesError} onRetry={loadRecent} />
        {!loadingEntries && !entriesError && (
          <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('labour.site')}</th>
                <th>{t('labour.workerName')}</th>
                <th>No of person</th>
                <th className="amount-cell">{t('labour.wageEarned')}</th>
                <th className="amount-cell">Old Balance</th>
                <th className="amount-cell">Total</th>
                <th className="amount-cell">{t('labour.paid')}</th>
                <th className="amount-cell">{t('labour.currentBalance')}</th>
                <th className="amount-cell">{t('labour.advance')}</th>
              </tr>
            </thead>
            <tbody>
              {recentEntries.map((e) => (
                <tr key={e._id}>
                  <td>{e.site}</td>
                  <td>{e.workerName}</td>
                  <td>{workerCountFor(e)}</td>
                  <td className="amount-cell">{formatCurrency(e.wageEarned)}</td>
                  <td className="amount-cell">{formatCurrency(e.balanceBefore || 0)}</td>
                  <td className="amount-cell">{formatCurrency(e.totalDue || e.wageEarned)}</td>
                  <td className="amount-cell">{formatCurrency(e.paid)}</td>
                  <td className="amount-cell">{formatCurrency(e.balanceAfter)}</td>
                  <td className="amount-cell">{formatCurrency(e.advance)}</td>
                </tr>
              ))}
              {recentEntries.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty-row">
                    {t('labour.noEntries')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
        {shareError && <div className="alert alert-error">{shareError}</div>}
        <div className="form-actions no-print">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={shareEntriesViaWhatsApp}
            disabled={sharingEntries || loadingEntries || recentEntries.length === 0}
          >
            {sharingEntries ? 'Preparing PDF...' : 'Share via WhatsApp'}
          </button>
        </div>
      </div>
    </div>
  );
}

// One blank row for the multi-add Workers form (item 10). "helperName", when
// filled, creates a second Worker record with role "Helper" and
// underWorker set to this row's Worker Name, in the same submit - the
// closest match to the requested "Helper Name" column without a schema
// change to the Worker model.
const emptyWorkerRow = () => ({
  name: '',
  site: '',
  helperName: '',
  role: '',
  dailyWage: '',
  vehicle: '',
  whatsappNumber: '',
});

function WorkersTab({ workers, loadingWorkers, workersError, sites, roles, onChange, onSiteAdded, t }) {
  const [rows, setRows] = useState([emptyWorkerRow()]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery, filteredWorkers] = useSearch(workers, ['name', 'site', 'role', 'vehicle', 'whatsappNumber']);

  const updateRow = (idx, field, value) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };
  // Item 10: "+" adds another blank worker row, so several workers can be
  // typed in and saved together instead of one submit per worker.
  const addRow = () => setRows((prev) => [...prev, emptyWorkerRow()]);
  const removeRow = (idx) => setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const addWorker = async (e) => {
    e.preventDefault();
    setError('');
    const toSave = rows.filter((r) => r.name.trim());
    if (toSave.length === 0) return;
    setSaving(true);
    try {
      for (const row of toSave) {
        const created = await workerApi.create({
          name: row.name.trim(),
          site: row.site,
          role: row.role,
          dailyWage: Number(row.dailyWage) || 0,
          vehicle: row.vehicle,
          whatsappNumber: row.whatsappNumber,
        });
        if (row.helperName.trim()) {
          await workerApi.create({
            name: row.helperName.trim(),
            site: row.site,
            role: 'Helper',
            underWorker: created?.data?.name || row.name.trim(),
            dailyWage: 0,
            whatsappNumber: '',
          });
        }
      }
      setRows([emptyWorkerRow()]);
      onChange();
    } catch (err) {
      setError(err.response?.data?.message || t('labour.errorSave'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (worker) => {
    await workerApi.update(worker._id, { active: !worker.active });
    onChange();
  };

  // Delete removes the person outright. force=true also removes their labour
  // entries - without it the API protects anyone who already has history.
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const doDelete = async (worker) => {
    setConfirmDelete(null);
    setDeletingId(worker._id);
    setError('');
    try {
      await workerApi.remove(`${worker._id}?force=true`);
      onChange();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not delete this worker.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      {confirmDelete && (
        <div className="modal-overlay no-print" onClick={() => setConfirmDelete(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Delete {confirmDelete.name}?</h3>
            <p style={{ margin: '8px 0 0', fontSize: '13.5px' }}>
              This removes the worker and any labour entries recorded against them. It cannot be undone.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={() => doDelete(confirmDelete)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      <form className="panel form" onSubmit={addWorker} onKeyDown={advanceOnEnter}>
        <h2>{t('labour.addWorker')}</h2>
        {error && <div className="alert alert-error">{error}</div>}
        {rows.map((row, idx) => (
          <div className="worker-add-row" key={idx}>
            {rows.length > 1 && (
              <button
                type="button"
                className="worker-row-remove-btn"
                onClick={() => removeRow(idx)}
                aria-label="Remove this worker row"
              >
                Remove
              </button>
            )}
            <div className="form-grid">
            <div className="form-field">
              <label>{t('labour.site')}</label>
              <SelectField
                searchable
                allowCustom
                value={row.site}
                onChange={(e) => updateRow(idx, 'site', e.target.value)}
                options={sites.map((s) => ({ value: s, label: s }))}
              />
            </div>
            <div className="form-field">
              <label>{t('labour.workerName')}</label>
              <input value={row.name} onChange={(e) => updateRow(idx, 'name', e.target.value)} required={idx === 0} />
            </div>
            <div className="form-field">
              <label>Helper Name</label>
              <input
                value={row.helperName}
                onChange={(e) => updateRow(idx, 'helperName', e.target.value)}
                placeholder="Optional - adds a linked helper"
              />
            </div>
            <div className="form-field">
              <label>{t('labour.role')}</label>
              <SelectField
                value={row.role}
                onChange={(e) => updateRow(idx, 'role', e.target.value)}
                allowClear
                clearLabel="Clear"
                options={roles.map((r) => ({ value: r, label: r }))}
              />
            </div>
            <div className="form-field">
              <label>{t('labour.dailyWage')}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={row.dailyWage}
                onChange={(e) => updateRow(idx, 'dailyWage', e.target.value)}
              />
            </div>
            <div className="form-field">
              <label>Vehicle</label>
              <input
                value={row.vehicle}
                onChange={(e) => updateRow(idx, 'vehicle', e.target.value)}
                placeholder="Own bike, TN49AB1234..."
              />
            </div>
            <div className="form-field">
              <label>WhatsApp Number</label>
              <input
                value={row.whatsappNumber}
                onChange={(e) => updateRow(idx, 'whatsappNumber', e.target.value)}
                placeholder="9876543210"
              />
            </div>
            </div>
          </div>
        ))}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={addRow}>
            + Add Another Worker
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? t('labour.saving') : t('labour.addWorker')}
          </button>
        </div>
      </form>


      <div className="panel">
        <div className="panel-header-row">
          <h2>{t('labour.tabWorkers')}</h2>
          <SearchBox value={query} onChange={setQuery} placeholder="Search workers..." />
        </div>
        <LoadingState loading={loadingWorkers} error={workersError} onRetry={onChange} />
        {!loadingWorkers && !workersError && (
          <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('labour.workerName')}</th>
                <th>{t('labour.site')}</th>
                <th>{t('labour.role')}</th>
                <th className="amount-cell">{t('labour.dailyWage')}</th>
                <th className="amount-cell">{t('labour.advance')}</th>
                <th className="amount-cell">{t('labour.paid')}</th>
                <th className="amount-cell">{t('labour.currentBalance')}</th>
                <th>{t('labour.active')}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredWorkers.map((w) => (
                <tr key={w._id} className={!w.active ? 'row-low-stock' : ''}>
                  <td>{w.name}</td>
                  <td>{w.site}</td>
                  <td>{w.role}</td>
                  <td className="amount-cell">{formatCurrency(w.dailyWage)}</td>
                  <td className="amount-cell">{formatCurrency(w.totalAdvance || 0)}</td>
                  <td className="amount-cell">{formatCurrency(w.totalPaid || 0)}</td>
                  <td className={`amount-cell${w.currentBalance > 0 ? ' danger-text' : ''}`}>{formatCurrency(w.currentBalance)}</td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleActive(w)}>
                      {w.active ? '✓' : '—'}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={deletingId === w._id}
                      onClick={() => setConfirmDelete(w)}
                    >
                      {deletingId === w._id ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
              {filteredWorkers.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty-row">
                    {workers.length === 0 ? t('labour.noWorkers') : 'No workers match your search.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SiteSheetTab({ sites, onSiteAdded, t }) {
  const [site, setSite] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const sheetRef = useRef(null);

  // Item 14: Admin (or Manager) can create a new site right here - it is
  // saved to the shared Settings.sites list (POST /api/settings/sites), so
  // it immediately shows up in every Site dropdown across both the Admin and
  // Manager portals (they all read the same GET /api/settings response).
  const [addingSite, setAddingSite] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteSaving, setNewSiteSaving] = useState(false);
  const [newSiteError, setNewSiteError] = useState('');

  const saveNewSite = async () => {
    const name = newSiteName.trim();
    if (!name) return;
    setNewSiteError('');
    setNewSiteSaving(true);
    try {
      await settingsApi.addSite(name);
      onSiteAdded?.(name);
      setSite(name);
      setNewSiteName('');
      setAddingSite(false);
    } catch (err) {
      setNewSiteError(err.response?.data?.message || 'Could not add this site.');
    } finally {
      setNewSiteSaving(false);
    }
  };

  const load = async () => {
    setError('');
    if (!site) {
      setError(t('labour.errorSelectSite'));
      return;
    }
    setLoading(true);
    try {
      const res = await labourApi.siteSheet({ site, from: from || undefined, to: to || undefined });
      setSheet(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load sheet');
    } finally {
      setLoading(false);
    }
  };

  const shareViaWhatsApp = () =>
    shareSheetViaWhatsApp({
      sheetRef,
      fileName: `Site-Sheet-${sheet.site}.pdf`,
      message: `R.S.A Construction - Site Sheet: ${sheet.site}\nWorkers: ${sheet.workerCount}\nTotal Balance Due: Rs.${Number(sheet.totalBalanceDue).toFixed(2)}`,
      setSharing,
      setError,
    });

  return (
    <div>
      <div className="panel no-print">
        <div className="form-grid">
          <div className="form-field">
            <label>{t('labour.selectSite')}</label>
            <SelectField
              searchable
              placeholder={t('labour.selectPlaceholder')}
              value={site}
              onChange={(e) => setSite(e.target.value)}
              options={sites.map((s) => ({ value: s, label: s }))}
            />
          </div>
          <div className="form-field">
            <label>{t('labour.fromDate')}</label>
            <DateField showTime={false} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="form-field">
            <label>{t('labour.toDate')}</label>
            <DateField showTime={false} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="form-field">
            <label>&nbsp;</label>
            <button type="button" className="btn btn-primary" onClick={load} disabled={loading}>
              {loading ? 'Loading...' : t('labour.loadSheet')}
            </button>
          </div>
          <div className="form-field">
            <label>&nbsp;</label>
            <button type="button" className="btn btn-ghost" onClick={() => setAddingSite((v) => !v)}>
              + New Site
            </button>
          </div>
        </div>
        {addingSite && (
          <div className="new-site-row">
            <input
              value={newSiteName}
              onChange={(e) => setNewSiteName(e.target.value)}
              placeholder="New site name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveNewSite();
                }
              }}
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={saveNewSite} disabled={newSiteSaving || !newSiteName.trim()}>
              {newSiteSaving ? 'Adding...' : 'Add Site'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAddingSite(false); setNewSiteName(''); setNewSiteError(''); }}>
              Cancel
            </button>
            {newSiteError && <span className="field-hint field-hint-error">{newSiteError}</span>}
          </div>
        )}
        {error && <div className="alert alert-error">{error}</div>}
      </div>

      {sheet && (
        <div className="panel ledger-print-area" ref={sheetRef}>
          <div className="page-header no-print">
            <h2 className="ledger-title">
              {t('labour.tabSiteSheet')}: {sheet.site} ({sheet.workerCount} workers)
            </h2>
            <div className="row-actions">
              <button type="button" className="btn btn-ghost" onClick={shareViaWhatsApp} disabled={sharing}>
                {sharing ? 'Preparing PDF...' : 'Share via WhatsApp'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
                {t('labour.printSheet')}
              </button>
            </div>
          </div>

          <div className="table-scroll">
          <table className="data-table stack-on-mobile">
            <thead>
              <tr>
                <th>{t('labour.date')}</th>
                <th>{t('labour.workerName')}</th>
                <th>{t('labour.daysWorked')}</th>
                <th className="amount-cell">{t('labour.wageEarned')}</th>
                <th className="amount-cell">{t('labour.advance')}</th>
                <th className="amount-cell">{t('labour.paid')}</th>
                <th className="amount-cell">{t('labour.currentBalance')}</th>
              </tr>
            </thead>
            <tbody>
              {sheet.entries.map((e) => (
                <tr key={e._id}>
                  <td data-label={t('labour.date')}>{formatDate(e.date)}</td>
                  <td data-label={t('labour.workerName')}>{e.workerName}</td>
                  <td data-label={t('labour.daysWorked')}>{e.daysWorked}</td>
                  <td className="amount-cell" data-label={t('labour.wageEarned')}>{formatCurrency(e.wageEarned)}</td>
                  <td className="amount-cell" data-label={t('labour.advance')}>{formatCurrency(e.advance)}</td>
                  <td className="amount-cell" data-label={t('labour.paid')}>{formatCurrency(e.paid)}</td>
                  <td className="amount-cell" data-label={t('labour.currentBalance')}>{formatCurrency(e.balanceAfter)}</td>
                </tr>
              ))}
              {sheet.entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-row">
                    {t('labour.noEntries')}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="total-label">
                  {t('labour.grandTotal')}
                </td>
                <td className="amount-cell total-amount">{formatCurrency(sheet.totals.wageEarned)}</td>
                <td className="amount-cell total-amount">{formatCurrency(sheet.totals.advance)}</td>
                <td className="amount-cell total-amount">{formatCurrency(sheet.totals.paid)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          </div>

          <h2 style={{ marginTop: 20 }}>{t('labour.workersAtSite')}</h2>
          <div className="table-scroll">
          <table className="data-table stack-on-mobile">
            <thead>
              <tr>
                <th>{t('labour.workerName')}</th>
                <th>{t('labour.role')}</th>
                <th className="amount-cell">{t('labour.dailyWage')}</th>
                <th className="amount-cell">{t('labour.currentBalance')}</th>
              </tr>
            </thead>
            <tbody>
              {sheet.workers.map((w) => (
                <tr key={w._id}>
                  <td data-label={t('labour.workerName')}>{w.name}</td>
                  <td data-label={t('labour.role')}>{w.role}</td>
                  <td className="amount-cell" data-label={t('labour.dailyWage')}>{formatCurrency(w.dailyWage)}</td>
                  <td className={`amount-cell${w.currentBalance > 0 ? ' danger-text' : ''}`} data-label={t('labour.currentBalance')}>{formatCurrency(w.currentBalance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="total-label">
                  {t('labour.totalBalanceDue')}
                </td>
                <td className="amount-cell total-amount">{formatCurrency(sheet.totalBalanceDue)}</td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ConsolidatedTab({ t }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const sheetRef = useRef(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await labourApi.consolidated({ from: from || undefined, to: to || undefined });
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load - the server may be slow to respond.');
    } finally {
      setLoading(false);
    }
  };

  // Loads once on mount with the default (all-time) range; From/To changes
  // after that only take effect once the Load button is clicked, same
  // explicit-reload pattern as the Monthly Salary tab below.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shareViaWhatsApp = () =>
    shareSheetViaWhatsApp({
      sheetRef,
      fileName: 'Consolidated-Site-Sheet.pdf',
      message: `R.S.A Construction - Consolidated Site Sheet\nTotal Workers: ${data?.grandTotal.workerCount}\nTotal Balance Due: Rs.${Number(data?.grandTotal.balanceDue || 0).toFixed(2)}`,
      setSharing,
      setError,
    });

  return (
    <div>
      <div className="panel no-print">
        <div className="form-grid">
          <div className="form-field">
            <label>{t('labour.fromDate')}</label>
            <DateField showTime={false} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="form-field">
            <label>{t('labour.toDate')}</label>
            <DateField showTime={false} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="form-field">
            <label>&nbsp;</label>
            <button type="button" className="btn btn-primary" onClick={load} disabled={loading}>
              {loading ? 'Loading...' : t('labour.loadSheet')}
            </button>
          </div>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
      </div>

      <div className="panel ledger-print-area" ref={sheetRef}>
        <div className="page-header no-print">
          <h2 className="ledger-title">{t('labour.tabConsolidated')}</h2>
          <div className="row-actions">
            <button type="button" className="btn btn-ghost" onClick={shareViaWhatsApp} disabled={sharing || !data}>
              {sharing ? 'Preparing PDF...' : 'Share via WhatsApp'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
              {t('labour.printSheet')}
            </button>
          </div>
        </div>
        <LoadingState loading={loading} />
        {!loading && (
          <div className="table-scroll">
          <table className="data-table stack-on-mobile">
            <thead>
              <tr>
                <th>{t('labour.site')}</th>
                <th>{t('labour.workerCount')}</th>
                <th className="amount-cell">{t('labour.totalWages')}</th>
                <th className="amount-cell">{t('labour.totalAdvance')}</th>
                <th className="amount-cell">{t('labour.totalPaid')}</th>
                <th className="amount-cell">{t('labour.totalBalanceDue')}</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((r) => (
                <tr key={r.site}>
                  <td data-label={t('labour.site')}>{r.site}</td>
                  <td data-label={t('labour.workerCount')}>{r.workerCount}</td>
                  <td className="amount-cell" data-label={t('labour.totalWages')}>{formatCurrency(r.wageEarned)}</td>
                  <td className="amount-cell" data-label={t('labour.totalAdvance')}>{formatCurrency(r.advance)}</td>
                  <td className="amount-cell" data-label={t('labour.totalPaid')}>{formatCurrency(r.paid)}</td>
                  <td className={`amount-cell${r.balanceDue > 0 ? ' danger-text' : ''}`} data-label={t('labour.totalBalanceDue')}>{formatCurrency(r.balanceDue)}</td>
                </tr>
              ))}
              {(!data || data.rows.length === 0) && (
                <tr>
                  <td colSpan={6} className="empty-row">
                    {t('labour.noEntries')}
                  </td>
                </tr>
              )}
            </tbody>
            {data && (
              <tfoot>
                <tr>
                  <td className="total-label">{t('labour.grandTotal')}</td>
                  <td className="amount-cell total-amount">{data.grandTotal.workerCount}</td>
                  <td className="amount-cell total-amount">{formatCurrency(data.grandTotal.wageEarned)}</td>
                  <td className="amount-cell total-amount">{formatCurrency(data.grandTotal.advance)}</td>
                  <td className="amount-cell total-amount">{formatCurrency(data.grandTotal.paid)}</td>
                  <td className="amount-cell total-amount">{formatCurrency(data.grandTotal.balanceDue)}</td>
                </tr>
              </tfoot>
            )}
          </table>
          </div>
        )}
      </div>
    </div>
  );
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function MonthlySalaryTab({ t }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await labourApi.monthlySalary({ year, month });
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load - the server may be slow to respond.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="panel no-print">
        <div className="form-grid">
          <div className="form-field">
            <label>Month</label>
            <SelectField
              aria-label="Month"
              value={String(month)}
              onChange={(e) => setMonth(Number(e.target.value))}
              options={MONTH_NAMES.map((m, i) => ({ value: String(i + 1), label: m }))}
            />
          </div>
          <div className="form-field">
            <label>Year</label>
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </div>
          <div className="form-field">
            <label>&nbsp;</label>
            <button type="button" className="btn btn-primary" onClick={load} disabled={loading}>
              {t('labour.loadSheet')}
            </button>
          </div>
        </div>
      </div>

      <div className="panel ledger-print-area">
        <div className="page-header no-print">
          <h2 className="ledger-title">
            Monthly Salary: {MONTH_NAMES[month - 1]} {year}
          </h2>
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
            {t('labour.printSheet')}
          </button>
        </div>
        <LoadingState loading={loading} error={error} onRetry={load} />
        {!loading && !error && (
          <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('labour.workerName')}</th>
                <th>{t('labour.site')}</th>
                <th>{t('labour.role')}</th>
                <th>{t('labour.daysWorked')}</th>
                <th className="amount-cell">{t('labour.wageEarned')}</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((r) => (
                <tr key={r.workerId}>
                  <td>{r.workerName}</td>
                  <td>{r.site}</td>
                  <td>{r.role}</td>
                  <td>{r.daysWorked}</td>
                  <td className="amount-cell">{formatCurrency(r.wageEarned)}</td>
                </tr>
              ))}
              {(!data || data.rows.length === 0) && (
                <tr>
                  <td colSpan={5} className="empty-row">
                    {t('labour.noEntries')}
                  </td>
                </tr>
              )}
            </tbody>
            {data && (
              <tfoot>
                <tr>
                  <td colSpan={4} className="total-label">
                    {t('labour.grandTotal')}
                  </td>
                  <td className="amount-cell total-amount">{formatCurrency(data.grandTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
