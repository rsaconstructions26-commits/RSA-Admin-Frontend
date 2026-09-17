import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { deliveryNoteApi, reportApi, settingsApi } from '../../api';
import STANDARD_PARTICULARS from '../../data/standardParticulars.js';
import { formatDate } from '../../utils/format.js';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useViewport } from '../../context/ViewportContext.jsx';
import { shareFile } from '../../utils/nativeShare.js';
import translations from '../../i18n/translations.js';
import logoImg from '../../logo/logoo2.png';

// Lightweight canvas signature pad (pointer events, no external library - see
// the "digital signature" build note for why a full library wasn't added).
// Draws in black on a white background so the exported PNG prints cleanly.
function SignaturePad({ onSave, onCancel, saving, allowType }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  // Item J: on a phone/tablet the person signs with a finger, which works
  // fine. On the web view there is no touch surface, so drawing a signature
  // with a mouse is effectively impossible - `allowType` turns on a typed
  // signature instead. Deliberately NOT offered on mobile, per the rule.
  const [mode, setMode] = useState('draw');
  const [typedName, setTypedName] = useState('');

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e) => {
    drawingRef.current = true;
    lastPointRef.current = getPos(e);
  };
  const move = (e) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const pos = getPos(e);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPointRef.current = pos;
  };
  const end = () => {
    drawingRef.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setTypedName('');
  };

  // Renders the typed name onto the same canvas the drawn signature uses, so
  // the saved PNG is identical in shape and the print/PDF path needs no
  // special case for typed signatures.
  const renderTyped = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 54;
    ctx.font = `italic ${size}px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive`;
    while (size > 18 && ctx.measureText(typedName).width > canvas.width - 40) {
      size -= 2;
      ctx.font = `italic ${size}px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive`;
    }
    ctx.fillText(typedName, canvas.width / 2, canvas.height / 2);
  };

  const save = () => {
    if (mode === 'type') {
      if (!typedName.trim()) return;
      renderTyped();
    }
    onSave(canvasRef.current.toDataURL('image/png'));
  };

  return (
    <div className="modal-overlay no-print" onClick={onCancel}>
      <div className="modal-box signature-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3>Sign here</h3>
        {mode === 'type' && (
          <div className="form-group" style={{ marginBottom: '10px' }}>
            <label htmlFor="typed-signature">Type your name</label>
            <input
              id="typed-signature"
              className="input"
              autoFocus
              value={typedName}
              placeholder="e.g. Salvin Jones"
              onChange={(e) => setTypedName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  save();
                }
              }}
            />
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={380}
          height={180}
          style={{
            border: '1px solid #999',
            touchAction: 'none',
            background: '#fff',
            maxWidth: '100%',
            cursor: mode === 'draw' ? 'crosshair' : 'default',
          }}
          onPointerDown={mode === 'draw' ? start : undefined}
          onPointerMove={mode === 'draw' ? move : undefined}
          onPointerUp={mode === 'draw' ? end : undefined}
          onPointerLeave={mode === 'draw' ? end : undefined}
        />
        {mode === 'type' && typedName.trim() ? (
          <div className="field-hint" style={{ marginTop: '6px' }}>
            Preview appears on the sheet when you save.
          </div>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={clear}>
            Clear
          </button>
          {allowType && (
            <button
              type="button"
              className="btn btn-ghost"
              aria-pressed={mode === 'type'}
              onClick={() => {
                setMode((m) => (m === 'type' ? 'draw' : 'type'));
                clear();
              }}
            >
              {mode === 'type' ? 'Draw' : 'Type'}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || (mode === 'type' && !typedName.trim())}
            onClick={save}
          >
            {saving ? 'Saving...' : 'Save Signature'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Pixel-faithful reproduction of the physical R.S.A Construction delivery note pad:
 * red company header, cell numbers, address, DELIVERY NOTE title, Date/S.No,
 * customer block, the fixed Particulars table (with Qty/Amount filled in where
 * billed, blank ruled lines otherwise, exactly like the paper pad), TOTAL,
 * declaration line, Vehicle No, and the two signature blocks + G Pay No footer.
 * Use the browser's Print / Save-as-PDF (Ctrl+P) for an exact A4 printout.
 */
export default function DeliveryNotePrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { isDesktop } = useViewport();
  const [note, setNote] = useState(null);
  const [particulars, setParticulars] = useState(STANDARD_PARTICULARS);
  const [itemColumns, setItemColumns] = useState([]);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [signatureSaving, setSignatureSaving] = useState(false);
  const frontSheetRef = useRef(null);
  const termsSheetRef = useRef(null);
  const termsSheetTaRef = useRef(null);

  useEffect(() => {
    deliveryNoteApi
      .get(id)
      .then((res) => setNote(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load delivery note'));
    settingsApi
      .get()
      .then((res) => {
        if (res.data.particulars?.length) setParticulars(res.data.particulars);
        setItemColumns(res.data.itemColumns || []);
      })
      .catch(() => {});
  }, [id]);

  const handleExportExcel = async () => {
    setError('');
    setExporting(true);
    try {
      await reportApi.exportDeliveryNotesExcel();
    } catch (err) {
      setError(err.message || 'Failed to export Excel');
    } finally {
      setExporting(false);
    }
  };

  // html2canvas snapshots whatever has already finished painting - if the
  // vehicle/receiver photo (loaded from Cloudinary, not bundled with the
  // app) hasn't finished downloading yet, it captures a blank box instead of
  // the photo. This waits for every <img> inside a sheet to actually finish
  // loading (or fail) before the canvas is taken, so the exported PDF never
  // grabs an empty frame mid-download.
  const waitForImages = (root) => {
    if (!root) return Promise.resolve();
    const imgs = Array.from(root.querySelectorAll('img'));
    return Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            })
      )
    );
  };

  // Renders the front sheet (and the terms sheet, if present) to canvases and
  // combines them into a single multi-page A4 PDF - i.e. an actual file, not
  // just a text message, so it can be attached to WhatsApp directly.
  const generatePdfBlob = async () => {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const sheets = [frontSheetRef.current, termsSheetTaRef.current].filter(Boolean);
    await Promise.all(sheets.map(waitForImages));

    for (let i = 0; i < sheets.length; i++) {
      const canvas = await html2canvas(sheets[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const imgHeight = (canvas.height * pageWidth) / canvas.width;
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, Math.min(imgHeight, pageHeight));
    }

    return pdf.output('blob');
  };

  const handleShareWhatsApp = async () => {
    setError('');
    setSharing(true);
    try {
      const blob = await generatePdfBlob();
      const fileName = `Delivery-Note-${note.noteNumber}.pdf`;
      const file = new File([blob], fileName, { type: 'application/pdf' });
      const message =
        `R.S.A Construction - Delivery Note ${note.noteNumber}\n` +
        `Date: ${formatDate(note.date)}\n` +
        `To: ${note.customerNameSnapshot}\n` +
        `Total: Rs.${note.totalAmount.toFixed(2)} (${note.paymentStatus})\n` +
        `Payment Mode: ${note.paymentMode || 'Cash'}${note.upiRefNumber ? ` (Ref: ${note.upiRefNumber})` : ''}`;

      // Items I and X: every platform must end up with the PDF attached -
      // native shell first (that is what the APK needs), then Web Share with
      // files, then the desktop download + prefilled chat. See
      // utils/nativeShare.js for why the order is what it is.
      await shareFile({
        blob,
        fileName,
        message,
        title: `Delivery Note ${note.noteNumber}`,
        phone: note.customerPhoneSnapshot,
        mimeType: 'application/pdf',
      });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setError('Could not prepare the PDF to share. Please try Print instead.');
      }
    } finally {
      setSharing(false);
    }
  };

  const handleSaveSignature = async (dataUrl) => {
    setSignatureSaving(true);
    setError('');
    try {
      const res = await deliveryNoteApi.saveSignature(id, dataUrl);
      setNote(res.data);
      setShowSignaturePad(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save signature');
    } finally {
      setSignatureSaving(false);
    }
  };

  if (error && !note) return <div className="alert alert-error">{error}</div>;
  if (!note) return <div className="page-loading">Loading...</div>;

  // Merge the fixed pre-printed particulars with whatever quantities/amounts were
  // actually billed on this note (matched by item name), plus any extra custom
  // items numbered sequentially after the highest standard number.
  const billedByName = new Map();
  note.items.forEach((it) => {
    const key = it.itemName.trim().toLowerCase();
    billedByName.set(key, it);
  });
  const usedKeys = new Set();
  // Only the rows that were actually filled in / billed on this note are
  // printed - the pre-printed pad's full particulars list is used purely to
  // look up the right No./label for whichever rows were used, not to show
  // every possible row blank.
  const printedRows = particulars
    .map((p) => {
      const key = p.label.trim().toLowerCase();
      const billed = billedByName.get(key);
      if (!billed) return null;
      usedKeys.add(key);
      return {
        no: p.no,
        label: language === 'ta' ? p.label : p.labelEn || p.label,
        quantity: billed.quantity,
        rate: billed.rate,
        perDayRate: billed.perDayRate,
        monthlyRate: billed.monthlyRate,
        amount: billed.amount,
        extra: billed.extra || {},
        dateTaken: billed.dateTaken,
        dateReturned: billed.dateReturned,
        selectedVariant: billed.selectedVariant || '',
      };
    })
    .filter(Boolean);
  const extraItems = note.items.filter((it) => !usedKeys.has(it.itemName.trim().toLowerCase()));

  // Item L: whatever was entered on the billing form has to be visible on the
  // printed sheet. A column is only rendered if at least one line actually
  // uses it, so a plain Qty x Rate note still looks like the paper pad.
  const hasRate = note.items.some((it) => Number(it.rate) > 0);
  const hasPerDay = note.items.some((it) => Number(it.perDayRate) > 0);
  const hasMonthly = note.items.some((it) => Number(it.monthlyRate) > 0);
  const money = (v) => (Number(v) > 0 ? Number(v).toFixed(2) : '');
  // Number of leading columns before the Amount column, used to keep the
  // TOTAL row's blank cells in step with the header.
  const rateColCount = (hasRate ? 1 : 0) + (hasPerDay ? 1 : 0) + (hasMonthly ? 1 : 0);

  // Only show the rental Taken/Returned columns at all if this note actually
  // has at least one rented (per-day) item - keeps the paper-exact look
  // uncluttered for the common case of a normal, non-rental delivery note.
  const hasRentalData = note.items.some((it) => it.dateTaken);

  // Formats a saved extra-column value for print: percent columns get a "%"
  // suffix, number columns are shown with 2 decimals, text columns as-is.
  const formatExtraValue = (col, extra) => {
    const raw = extra ? extra[col.key] : undefined;
    if (raw === undefined || raw === null || raw === '') return '';
    if (col.type === 'text') return raw;
    const n = Number(raw);
    if (Number.isNaN(n)) return '';
    return col.type === 'percent' ? `${n}%` : n.toFixed(2);
  };
  const formatRentalDate = (d) => (d ? formatDate(d) : '');

  return (
    <div className="print-page-wrapper">
      <div className="print-toolbar no-print">
        <button className="btn btn-ghost" onClick={() => navigate(-1)}>
          ← {t('print.back')}
        </button>
        <div className="print-toolbar-actions">
          <button className="btn btn-ghost" onClick={handleExportExcel} disabled={exporting}>
            {exporting ? t('print.exporting') : t('print.exportExcel')}
          </button>
          <button className="btn btn-ghost" onClick={handleShareWhatsApp} disabled={sharing}>
            {sharing ? 'Preparing PDF...' : 'Share via WhatsApp'}
          </button>
          <button className="btn btn-ghost" onClick={() => setShowSignaturePad(true)}>
            {note.receiverSignature?.url ? 'Re-sign' : 'Sign'}
          </button>
          <button className="btn btn-primary" onClick={() => window.print()}>
            {t('print.print')}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error no-print">{error}</div>}

      {showSignaturePad && (
        <SignaturePad
          onSave={handleSaveSignature}
          onCancel={() => setShowSignaturePad(false)}
          saving={signatureSaving}
          allowType={isDesktop}
        />
      )}

      {(note.vehiclePhoto?.url || note.receiverPhoto?.url) && (
        <div className="print-toolbar no-print" style={{ marginTop: 0 }}>
          {note.vehiclePhoto?.url && (
            <a
              href={note.vehiclePhoto.url}
              target="_blank"
              rel="noopener noreferrer"
              className="vehicle-photo-thumb-link"
              title="Open full-size vehicle photo"
            >
              <img src={note.vehiclePhoto.url} alt="Vehicle" />
            </a>
          )}
          {note.receiverPhoto?.url && (
            <a
              href={note.receiverPhoto.url}
              target="_blank"
              rel="noopener noreferrer"
              className="vehicle-photo-thumb-link"
              title="Open full-size receiver photo"
            >
              <img src={note.receiverPhoto.url} alt="Receiver" />
            </a>
          )}
          <span className="field-hint">Photo(s) on file. Click to view full size.</span>
        </div>
      )}

      <div className="delivery-note-sheet" ref={frontSheetRef}>
        <img src={logoImg} alt="" aria-hidden="true" className="dn-watermark" />
        <div className="dn-header">
          <div className="dn-header-top">
            <div className="dn-company-block">
              {/* Item K: the actual RSA mark sits immediately in front of the
                  company name on the printed sheet, not only as the faint
                  watermark behind it. */}
              <img src={logoImg} alt="" aria-hidden="true" className="dn-header-logo" />
              <h1 className="dn-company-name">{t('print.companyName')}</h1>
            </div>
            <div className="dn-cell-block">
              <div>{t('print.cellLabel')} : 90470 35567</div>
              <div>93603 42993</div>
            </div>
          </div>
          <div className="dn-address">{t('print.address')}</div>
          <div className="dn-rental-note">{t('print.rentalNote')}</div>
        </div>

        <div className="dn-title-row">
          <div className="dn-title-block">
            <h2 className="dn-title">{t('print.deliveryNoteTitle')}</h2>
          </div>
          <div className="dn-meta-block">
            <div className="dn-meta-row">
              <span className="dn-meta-label">{t('print.dateLabel')} :</span>
              <span className="dn-meta-value">{formatDate(note.date)}</span>
            </div>
            <div className="dn-meta-row">
              <span className="dn-meta-label">{t('print.serialNo')} :</span>
              <span className="dn-meta-value">{note.noteNumber}</span>
            </div>
          </div>
        </div>

        <div className="dn-customer-row">
          <div>
            <span className="dn-meta-label">{t('print.to')} :</span> {note.customerNameSnapshot}
            {note.customerPhoneSnapshot ? `, ${note.customerPhoneSnapshot}` : ''}
          </div>
          <div>{note.customerAddressSnapshot}</div>
        </div>

        <table className="dn-table">
          <thead>
            <tr>
              <th className="dn-col-no">{t('print.colNo')}</th>
              <th className="dn-col-particulars">{t('print.colParticulars')}</th>
              <th className="dn-col-qty">{t('print.colQty')}</th>
              {hasRate && <th className="dn-col-extra">Rate</th>}
              {hasPerDay && <th className="dn-col-extra">Per-day Rate</th>}
              {hasMonthly && <th className="dn-col-extra">Monthly Rate</th>}
              {hasRentalData && (
                <>
                  <th className="dn-col-extra">{t('print.colTaken')}</th>
                  <th className="dn-col-extra">{t('print.colReturned')}</th>
                </>
              )}
              {itemColumns.map((col) => (
                <th key={col._id} className="dn-col-extra">
                  {col.label}
                </th>
              ))}
              <th className="dn-col-amount">{t('print.colAmount')}</th>
            </tr>
          </thead>
          <tbody>
            {printedRows.map((row, idx) => (
              <tr key={idx}>
                {/* Item G: the printed sheet numbers the rows that were
                    actually billed 1..n. The pad's catalogue number (row.no,
                    e.g. 43) stays in the data but never reaches the paper. */}
                <td className="dn-col-no">{idx + 1}</td>
                <td className="dn-col-particulars">
                  {row.label}
                  {row.selectedVariant ? ` (${row.selectedVariant})` : ''}
                </td>
                <td className="dn-col-qty">{row.quantity !== '' ? row.quantity : ''}</td>
                {hasRate && <td className="dn-col-extra">{money(row.rate)}</td>}
                {hasPerDay && <td className="dn-col-extra">{money(row.perDayRate)}</td>}
                {hasMonthly && <td className="dn-col-extra">{money(row.monthlyRate)}</td>}
                {hasRentalData && (
                  <>
                    <td className="dn-col-extra">{formatRentalDate(row.dateTaken)}</td>
                    <td className="dn-col-extra">{formatRentalDate(row.dateReturned)}</td>
                  </>
                )}
                {itemColumns.map((col) => (
                  <td key={col._id} className="dn-col-extra">
                    {formatExtraValue(col, row.extra)}
                  </td>
                ))}
                <td className="dn-col-amount">{row.amount !== '' ? Number(row.amount).toFixed(2) : ''}</td>
              </tr>
            ))}
            {extraItems.map((it, idx) => (
              <tr key={`extra-${idx}`}>
                <td className="dn-col-no">{printedRows.length + idx + 1}</td>
                <td className="dn-col-particulars">
                  {it.itemName}
                  {it.selectedVariant ? ` (${it.selectedVariant})` : ''}
                </td>
                <td className="dn-col-qty">{it.quantity}</td>
                {hasRate && <td className="dn-col-extra">{money(it.rate)}</td>}
                {hasPerDay && <td className="dn-col-extra">{money(it.perDayRate)}</td>}
                {hasMonthly && <td className="dn-col-extra">{money(it.monthlyRate)}</td>}
                {hasRentalData && (
                  <>
                    <td className="dn-col-extra">{formatRentalDate(it.dateTaken)}</td>
                    <td className="dn-col-extra">{formatRentalDate(it.dateReturned)}</td>
                  </>
                )}
                {itemColumns.map((col) => (
                  <td key={col._id} className="dn-col-extra">
                    {formatExtraValue(col, it.extra)}
                  </td>
                ))}
                <td className="dn-col-amount">{Number(it.amount).toFixed(2)}</td>
              </tr>
            ))}
            <tr className="dn-total-row">
              <td className="dn-col-no" colSpan={2}>
                {t('print.total')}
              </td>
              <td className="dn-col-qty" />
              {Array.from({ length: rateColCount }, (_, i) => (
                <td key={`rate-pad-${i}`} className="dn-col-extra" />
              ))}
              {hasRentalData && (
                <>
                  <td className="dn-col-extra" />
                  <td className="dn-col-extra" />
                </>
              )}
              {itemColumns.map((col) => (
                <td key={col._id} className="dn-col-extra" />
              ))}
              <td className="dn-col-amount">{note.totalAmount.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <div className="dn-declaration">{t('print.declaration')}</div>

        {/* Vehicle + receiver photos, printed side by side (medium boxes) right
            on the sheet itself - previously these only showed as small
            clickable thumbnails in the on-screen toolbar above, which never
            made it into the printed/PDF/WhatsApp-shared copy. */}
        {(note.vehiclePhoto?.url || note.receiverPhoto?.url) && (
          <div className="dn-photos-row">
            {note.vehiclePhoto?.url && (
              <div className="dn-photo-box">
                {/* No crossOrigin attribute here - Cloudinary's default image
                    delivery doesn't send an Access-Control-Allow-Origin header
                    for every resource type, and setting crossOrigin="anonymous"
                    on an <img> the browser can't verify as CORS-enabled makes
                    it refuse to load the image at all (blank box, both on
                    screen and in print/PDF). html2canvas's own useCORS:true
                    option below handles the PDF-export case without needing
                    this attribute on the tag itself. */}
                <img src={note.vehiclePhoto.url} alt="Vehicle" />
                <span>Vehicle Photo</span>
              </div>
            )}
            {note.receiverPhoto?.url && (
              <div className="dn-photo-box">
                <img src={note.receiverPhoto.url} alt="Receiver" />
                <span>Receiver Photo</span>
              </div>
            )}
          </div>
        )}

        <div className="dn-footer-row">
          <div className="dn-vehicle">
            {t('print.vehicleNo')}: <span className="dn-underline">{note.vehicleNumber || ''}</span>
          </div>
          <div className="dn-payment">
            {t('print.paymentStatus')}: {note.paymentStatus}
            {' · '}
            {t('voucher.paymentMode')}: {note.paymentMode || 'Cash'}
            {note.paymentMode === 'GPay/UPI' && note.upiRefNumber ? ` (${note.upiRefNumber})` : ''}
          </div>
        </div>

        <div className="dn-signature-row">
          <div className="dn-signature-block">
            <div className="dn-signature-line" />
            <div>{t('print.ownerSignature')}</div>
          </div>
          <div className="dn-gpay-block">
            <div>{t('print.cellLabel')} :</div>
            <div>{t('print.gpayLabel')} : 9442239314</div>
          </div>
          <div className="dn-signature-block">
            {note.receiverSignature?.url ? (
              <img src={note.receiverSignature.url} alt="Signature" style={{ maxHeight: '40px', maxWidth: '100%' }} />
            ) : (
              <div className="dn-signature-line" />
            )}
            <div>{t('print.pickupSignature')}</div>
          </div>
        </div>        <div className="dn-footer-banner">RAJAM TEXTILES &amp; RAJAM STORES</div>

        {/* Embedded English Notice at the bottom of Page 1 */}
        <div style={{ marginTop: '15px', paddingTop: '12px', borderTop: '1px dashed #333' }}>
          <h4 style={{ textAlign: 'center', background: '#dfe3f0', border: '1px solid #333', padding: '3px', fontSize: '11px', margin: '0 0 6px', fontWeight: 'bold' }}>IMPORTANT NOTICE</h4>
          <ol style={{ paddingLeft: '15px', margin: 0, fontSize: '9px', lineHeight: '1.3' }}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <li key={n} style={{ marginBottom: '3px' }}>
                {translations.en.print[`terms${n}`]}
              </li>
            ))}
          </ol>
          <div style={{ marginTop: '8px', fontSize: '9.5px', textAlign: 'center', fontWeight: 'bold', color: '#333' }}>
            Working Hours: 8:00 AM to 6:00 PM
          </div>
        </div>
      </div>

      {/* Page 2: Tamil Terms Sheet */}
      <div className="delivery-note-sheet dn-terms-sheet" ref={termsSheetTaRef}>
        <img src={logoImg} alt="" aria-hidden="true" className="dn-watermark" />
        <h2 className="dn-terms-title" style={{ fontWeight: 'bold' }}>முக்கிய அறிவிப்பு</h2>
        <ol className="dn-terms-list">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => {
            const taText = translations.ta.print[`terms${n}`];
            return (
              <li key={n} className="dn-terms-item">
                <div className="dn-terms-ta" style={{ fontWeight: '600' }}>{taText}</div>
              </li>
            );
          })}
        </ol>
        <div className="dn-footer-banner">வேலை நேரம்: காலை 8:00 மணி முதல் மாலை 6:00 மணி வரை</div>
      </div>
    </div>
  );
}