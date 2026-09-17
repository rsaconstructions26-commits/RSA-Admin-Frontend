import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { voucherApi } from '../../api';
import { formatDate } from '../../utils/format.js';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useViewport } from '../../context/ViewportContext.jsx';
import logoImg from '../../logo/logoo2.png';
import DefaultSignature from '../common/DefaultSignature.jsx';
import { shareFile } from '../../utils/nativeShare.js';

// Item 7: identical draw-or-type signature pad to DeliveryNotePrint.jsx's
// SignaturePad (kept as a local copy rather than a shared import, matching
// how this codebase already duplicates the print-page pattern per module).
function SignaturePad({ onSave, onCancel, saving, allowType }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
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
            <label htmlFor="voucher-typed-signature">Type your name</label>
            <input
              id="voucher-typed-signature"
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
            Preview appears on the voucher when you save.
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
 * Reproduction of the physical blue "வவுச்சர்" (Voucher) slip - No./Date,
 * Received From, Received By, Purpose, the Advance/Part/Full payment-type
 * line, the boxed amount, and the two signature lines. Prints entirely in
 * whichever language (English or Tamil) is currently selected in the app's
 * language toggle. Use the browser's Print / Save-as-PDF (Ctrl+P).
 */
export default function VoucherPrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { isDesktop } = useViewport();
  const [voucher, setVoucher] = useState(null);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [signatureSaving, setSignatureSaving] = useState(false);
  const sheetRef = useRef(null);

  const handleSaveSignature = async (dataUrl) => {
    setSignatureSaving(true);
    setError('');
    try {
      const res = await voucherApi.saveSignature(id, dataUrl);
      setVoucher(res.data);
      setShowSignaturePad(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save signature');
    } finally {
      setSignatureSaving(false);
    }
  };

  useEffect(() => {
    voucherApi
      .get(id)
      .then((res) => setVoucher(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load voucher'));
  }, [id]);

  // Same fix as the Delivery Note print view: make sure every <img> in the
  // sheet (the watermark, plus any future photo) has actually finished
  // loading before html2canvas takes its snapshot, so nothing captures blank.
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

  const generatePdfBlob = async () => {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    await waitForImages(sheetRef.current);
    const canvas = await html2canvas(sheetRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const imgHeight = (canvas.height * pageWidth) / canvas.width;
    pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, Math.min(imgHeight, pageHeight));
    return pdf.output('blob');
  };

  // Item V: the voucher goes to WhatsApp as a PICTURE, not a PDF - the client
  // wants the recipient to see the slip in the chat without opening an
  // attachment. Same html2canvas snapshot the PDF path uses, exported as PNG.
  const generateImageBlob = async () => {
    await waitForImages(sheetRef.current);
    const canvas = await html2canvas(sheetRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  };

  const handleShareWhatsApp = async () => {
    setError('');
    setSharing(true);
    try {
      const blob = await generateImageBlob();
      const fileName = `Voucher-${voucher.voucherNumber}.png`;
      const message =
        `R.S.A Construction - Voucher ${voucher.voucherNumber}\n` +
        `Date: ${formatDate(voucher.date)}\n` +
        `Received By: ${voucher.receivedBy}\n` +
        `Amount: Rs.${Number(voucher.amount).toFixed(2)} (${voucher.paymentType})\n` +
        `Payment Mode: ${voucher.paymentMode || 'Cash'}${voucher.upiRefNumber ? ` (Ref: ${voucher.upiRefNumber})` : ''}`;

      await shareFile({
        blob,
        fileName,
        message,
        title: `Voucher ${voucher.voucherNumber}`,
        mimeType: 'image/png',
      });
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setError('Could not prepare the PDF to share. Please try Print instead.');
      }
    } finally {
      setSharing(false);
    }
  };

  if (error && !voucher) return <div className="alert alert-error">{error}</div>;
  if (!voucher) return <div className="page-loading">Loading...</div>;

  const paymentTypeLabel = { Advance: t('voucher.advance'), Part: t('voucher.part'), Full: t('voucher.full') }[
    voucher.paymentType
  ];

  return (
    <div className="print-page-wrapper">
      <div className="print-toolbar no-print">
        <button className="btn btn-ghost" onClick={() => navigate(-1)}>
          ← {t('print.back')}
        </button>
        <div className="print-toolbar-actions">
          <button className="btn btn-ghost" onClick={handleShareWhatsApp} disabled={sharing}>
            {sharing ? 'Preparing image...' : 'Share via WhatsApp'}
          </button>
          <button className="btn btn-ghost" onClick={() => setShowSignaturePad(true)}>
            {voucher.receiverSignature?.url ? 'Re-sign' : 'Sign'}
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

      <div className="voucher-sheet" ref={sheetRef}>
        <div className="voucher-box">
          <img src={logoImg} alt="" aria-hidden="true" className="voucher-watermark" />
          <div className="voucher-box-header">
            <div className="voucher-no">
              {t('print.voucherNo')} <span className="voucher-underline">{voucher.voucherNumber}</span>
            </div>
            <div className="voucher-title-badge">{t('print.voucherTitle')}</div>
            <div className="voucher-date">
              {t('print.dateLabel')} <span className="voucher-underline">{formatDate(voucher.date)}</span>
            </div>
          </div>

          <div className="voucher-line">
            <span className="voucher-underline voucher-line-value">{voucher.receivedFrom}</span>
            <span className="voucher-line-label">{t('print.receivedFrom')}</span>
          </div>

          <div className="voucher-line">
            <span className="voucher-line-label voucher-line-label-fixed">{t('print.receivedByPrefix')}</span>
            <span className="voucher-underline voucher-line-value">{voucher.receivedBy}</span>
            <span className="voucher-line-label voucher-line-label-end">{t('print.receivedBySuffix')}</span>
          </div>

          <div className="voucher-line">
            <span className="voucher-underline voucher-line-value">{voucher.purpose}</span>
            <span className="voucher-line-label">{t('print.forPurpose')}</span>
          </div>

          <div className="voucher-line">
            <span className="voucher-line-label voucher-line-label-fixed">
              {t('print.advance')}/{t('print.part')}/{t('print.full')}
              {' - '}
              <strong>{paymentTypeLabel}</strong>
            </span>
            <span className="voucher-line-label voucher-line-label-end">{t('print.rupees')}</span>
          </div>

          <div className="voucher-received-only">{t('print.receivedOnly')}</div>

          {voucher.remarks && (
            <div className="voucher-remarks">
              {t('voucher.remarks')}: {voucher.remarks}
            </div>
          )}

          <div className="voucher-footer-row">
            <div className="voucher-amount-box">
              <span className="voucher-amount-label">{t('print.rsLabel')}</span>
              <span className="voucher-amount-value">{Number(voucher.amount).toFixed(2)}</span>
            </div>
            <div className="voucher-signature-block">
              {/* Item 7: a real captured signature (drawn or typed via the
                  "Sign" button above) always takes priority once one exists.
                  Otherwise, a non-cash voucher shows its payment reference,
                  and a cash voucher falls back to the default placeholder. */}
              {voucher.receiverSignature?.url ? (
                <img
                  src={voucher.receiverSignature.url}
                  alt="Receiver signature"
                  className="voucher-signature-image"
                  style={{ maxHeight: '40px', maxWidth: '100%' }}
                />
              ) : voucher.paymentMode && voucher.paymentMode !== 'Cash' ? (
                <div className="voucher-payment-ref">
                  Paid via {voucher.paymentMode}
                  {voucher.upiRefNumber ? ` (Ref: ${voucher.upiRefNumber})` : ''}
                </div>
              ) : (
                <DefaultSignature className="voucher-signature-image" />
              )}
              <div className="voucher-signature-line" />
              <div>{t('print.receiverSignature')}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
