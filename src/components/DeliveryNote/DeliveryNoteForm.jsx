import React, { useEffect, useMemo, useRef, useState } from 'react';
import { advanceOnEnter } from '../../utils/formFlow.js';
import SelectField from '../common/SelectField.jsx';
import { useNavigate, useParams } from 'react-router-dom';
import { customerApi, deliveryNoteApi, settingsApi } from '../../api';
import { formatCurrency } from '../../utils/format.js';
import STANDARD_PARTICULARS, { DEFAULT_SHEET_SIZE_OPTIONS } from '../../data/standardParticulars.js';
import { computeItemAmount } from '../../utils/itemAmount.js';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useViewport } from '../../context/ViewportContext.jsx';
import BackButton from '../common/BackButton.jsx';
import DateField from '../common/DateField.jsx';
import {
  sanitizePhoneInput,
  isValidPhone,
  PHONE_HELP,
  sanitizeVehicleInput,
  isValidVehicleNumber,
  isVehicleNumberProvided,
  VEHICLE_HELP,
  VEHICLE_REQUIRED_HELP,
} from '../../utils/validators.js';

const emptyItem = () => ({
  itemName: '',
  quantity: '',
  rate: '',
  custom: true,
  extra: {},
  perDayRate: '',
  monthlyRate: '',
  dateTaken: '',
  dateReturned: '',
  selectedVariant: '',
});

// Picks the display text for a particular row according to the current UI
// language: English shows `labelEn` (falling back to `label` if a row was
// created before labelEn existed), Tamil always shows `label`.
const particularText = (p, language) => {
  if (language === 'en') return p.labelEn && p.labelEn.trim() ? p.labelEn : p.label;
  return p.label;
};

// Pre-fills the item rows with the pad's fixed "Particulars" list (blank qty/rate),
// exactly like the pre-printed paper form - staff only fill in the rows that apply.
// The list itself comes from the database (editable in the Superadmin panel);
// STANDARD_PARTICULARS is only used as an offline fallback if that request fails.
const standardRows = (particulars, language) =>
  particulars.map((p) => ({
    itemName: particularText(p, language),
    quantity: '',
    rate: p.defaultRate || '',
    custom: false,
    no: p.no,
    particularId: p._id || null,
    extra: {},
    perDayRate: p.defaultPerDayRate || '',
    monthlyRate: p.defaultMonthlyRate || '',
    dateTaken: '',
    dateReturned: '',
    selectedVariant: '',
  }));

// When re-opening a saved note for edit, match each saved line item back to its
// fixed Particulars row by stable particularId first (survives any later
// reordering/renaming in the Superadmin Panel), falling back to matching by
// itemName for notes saved before particularId existed. Only if neither match
// is found is a row treated as a genuine custom/one-off item. This is what
// keeps data typed against row 9 or row 10 reliably reappearing under that
// same row number - never guessed from array position.
const matchSavedItemToParticular = (savedItem, particulars) => {
  if (savedItem.particularId) {
    const byId = particulars.find((p) => String(p._id) === String(savedItem.particularId));
    if (byId) return byId;
  }
  const byName = particulars.find((p) => p.label === savedItem.itemName);
  if (byName) return byName;
  return null;
};

// Same matching rule as matchSavedItemToParticular, used at render time to
// find a row's variants (if any) so the variant <select> only shows up next
// to rows that actually have some.
const findParticularForRow = (row, particulars) => {
  if (row.particularId) {
    const byId = particulars.find((p) => String(p._id) === String(row.particularId));
    if (byId) return byId;
  }
  return particulars.find((p) => p.no === row.no) || null;
};

export default function DeliveryNoteForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const { isMobile } = useViewport();

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', address: '' });
  const [useNewCustomer, setUseNewCustomer] = useState(true);
  const [vehicleNumber, setVehicleNumber] = useState('');
  // Vehicle photo: vehiclePhotoUrl is what's already saved on the server (null
  // until one is uploaded); vehiclePhotoFile is a newly picked file waiting to
  // be uploaded; photoPreview is whichever of those should currently be shown.
  const [vehiclePhotoUrl, setVehiclePhotoUrl] = useState(null);
  const [vehiclePhotoFile, setVehiclePhotoFile] = useState(null);
  const [vehiclePhotoFilePreview, setVehiclePhotoFilePreview] = useState(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [photoUploadedNotice, setPhotoUploadedNotice] = useState('');
  const photoInputRef = useRef(null);
  // Second ("receiver") photo - identical shape/flow to the vehicle photo above.
  const [receiverPhotoUrl, setReceiverPhotoUrl] = useState(null);
  const [receiverPhotoFile, setReceiverPhotoFile] = useState(null);
  const [receiverPhotoFilePreview, setReceiverPhotoFilePreview] = useState(null);
  const [receiverPhotoUploading, setReceiverPhotoUploading] = useState(false);
  const [receiverPhotoError, setReceiverPhotoError] = useState('');
  const [receiverPhotoUploadedNotice, setReceiverPhotoUploadedNotice] = useState('');
  const receiverPhotoInputRef = useRef(null);
  const [scanningAadhaar, setScanningAadhaar] = useState(false);
  const [aadhaarError, setAadhaarError] = useState('');
  const [aadhaarNotice, setAadhaarNotice] = useState('');
  const aadhaarInputRef = useRef(null);
  const [particulars, setParticulars] = useState(STANDARD_PARTICULARS);
  // Shared size list a particular can opt into via variantSizeSource (e.g.
  // Column Box and Sheets both showing the exact same sizes) - see
  // resolveVariantOptions below for how this and a particular's own
  // `variants` (label -> rate lookup) combine.
  const [sheetSizeOptions, setSheetSizeOptions] = useState(DEFAULT_SHEET_SIZE_OPTIONS);
  const [itemColumns, setItemColumns] = useState([]);
  const [items, setItems] = useState(() => standardRows(STANDARD_PARTICULARS, language));
  // Which particular's tab is open on the mobile "one item at a time" layout
  // below (see the isMobile branch further down) - unused on desktop, which
  // still shows every row in a single table.
  const [activeItemIdx, setActiveItemIdx] = useState(0);
  const [paymentStatus, setPaymentStatus] = useState('Pending');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [upiRefNumber, setUpiRefNumber] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    customerApi.list().then((res) => setCustomers(res.data));
  }, []);

  // Build a preview URL for a newly-picked (not-yet-uploaded) photo file, and
  // clean it up whenever the file changes or the form unmounts - object URLs
  // otherwise leak memory for as long as the page stays open.
  useEffect(() => {
    if (!vehiclePhotoFile) {
      setVehiclePhotoFilePreview(null);
      return;
    }
    const objectUrl = URL.createObjectURL(vehiclePhotoFile);
    setVehiclePhotoFilePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [vehiclePhotoFile]);

  useEffect(() => {
    if (!receiverPhotoFile) {
      setReceiverPhotoFilePreview(null);
      return;
    }
    const objectUrl = URL.createObjectURL(receiverPhotoFile);
    setReceiverPhotoFilePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [receiverPhotoFile]);

  // Extra item columns (Discount, etc.) apply regardless of create/edit, so this
  // fetch runs either way - only the *prefilled row list* below is create-only.
  useEffect(() => {
    settingsApi
      .get()
      .then((res) => setItemColumns(res.data.itemColumns || []))
      .catch(() => {
        /* no extra columns available offline - form still works without them */
      });
  }, []);

  useEffect(() => {
    // Particulars are needed whether creating or editing: creating uses them to
    // prefill the standard rows, editing uses them to re-match each saved line
    // item back to its correct fixed row (see matchSavedItemToParticular above).
    settingsApi
      .get()
      .then((res) => {
        if (res.data.particulars?.length) {
          setParticulars(res.data.particulars);
          if (!isEdit) setItems(standardRows(res.data.particulars, language));
        }
        if (res.data.sheetSizeOptions?.length) setSheetSizeOptions(res.data.sheetSizeOptions);
      })
      .catch(() => {
        /* keep the offline fallback list already in state */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit]);

  // Re-translate the standard (non-custom) rows' displayed itemName whenever the
  // language toggle changes, without touching whatever the staff has already
  // typed into quantity/rate/dates for those rows. Custom rows are left as-is
  // since their name was hand-typed and isn't part of the bilingual list.
  useEffect(() => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.custom) return it;
        const match = particulars.find(
          (p) => (it.particularId && String(p._id) === String(it.particularId)) || p.no === it.no
        );
        return match ? { ...it, itemName: particularText(match, language) } : it;
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    if (!isEdit) return;
    // Wait for the current particulars list before mapping the note's saved
    // items, so each one can be matched back to its fixed row correctly.
    settingsApi
      .get()
      .catch(() => null)
      .then((res) => {
        const currentParticulars = res?.data?.particulars?.length ? res.data.particulars : particulars;
        deliveryNoteApi.get(id).then((noteRes) => {
          const n = noteRes.data;
          setDate(new Date(n.date).toISOString().slice(0, 10));
          setUseNewCustomer(false);
          setCustomerId(n.customer?._id || n.customer);
          setVehicleNumber(n.vehicleNumber || '');
          setVehiclePhotoUrl(n.vehiclePhoto?.url || null);
          setReceiverPhotoUrl(n.receiverPhoto?.url || null);
          setItems(
            n.items.map((it) => {
              const matched = matchSavedItemToParticular(it, currentParticulars);
              return {
                itemName: it.itemName,
                quantity: it.quantity,
                rate: it.rate,
                custom: !matched,
                no: matched ? matched.no : '',
                particularId: matched ? matched._id : null,
                extra: it.extra || {},
                perDayRate: it.perDayRate || '',
                monthlyRate: it.monthlyRate || '',
                dateTaken: it.dateTaken ? new Date(it.dateTaken).toISOString().slice(0, 10) : '',
                dateReturned: it.dateReturned ? new Date(it.dateReturned).toISOString().slice(0, 10) : '',
                selectedVariant: it.selectedVariant || '',
              };
            })
          );
          setPaymentStatus(n.paymentStatus);
          setPaymentMode(n.paymentMode || 'Cash');
          setUpiRefNumber(n.upiRefNumber || '');
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEdit]);

  const totals = useMemo(() => {
    return items.map((it) => computeItemAmount(it, itemColumns));
  }, [items, itemColumns]);

  const grandTotal = useMemo(() => totals.reduce((s, a) => s + a, 0), [totals]);

  // Numbered by row position (1, 2, 3...) rather than each particular's own
  // stored `no` field - that field is admin-assigned in the Superadmin Panel
  // and can have gaps (e.g. 1, 9, 10, 13, 14...), which showed directly in
  // this column since it used to render `it.no` verbatim.
  const displayNumbers = useMemo(() => items.map((_, idx) => String(idx + 1)), [items]);

  // A particular's variant OPTIONS (the labels offered in the dropdown) come
  // from its own `variants` array, unless it opts into a shared list via
  // variantSizeSource (e.g. Column Box/Sheets both offering the same sizes -
  // see Settings.js particularSchema.variantSizeSource). Each label's
  // rate/perDayRate still comes from this particular's own `variants` entry
  // (falling back to 0/blank if the shared list has a size this particular
  // hasn't priced yet), so two linked particulars always show the same size
  // choices while billing them independently.
  const resolveVariantOptions = (particular) => {
    if (!particular) return [];
    if (particular.variantSizeSource === 'settings.sheetSizeOptions') {
      return sheetSizeOptions.map((label) => {
        const existing = (particular.variants || []).find((v) => v.label === label);
        return existing || { label, rate: 0, perDayRate: 0 };
      });
    }
    return particular.variants || [];
  };

  // Selecting a variant auto-fills that row's rate/perDayRate, the same way
  // standardRows() seeds a row's defaults from the particular itself.
  const updateItemVariant = (idx, variantLabel) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const particular = findParticularForRow(it, particulars);
        const variant = resolveVariantOptions(particular).find((v) => v.label === variantLabel);
        if (!variant) return { ...it, selectedVariant: '' };
        return { ...it, selectedVariant: variantLabel, rate: variant.rate || '', perDayRate: variant.perDayRate || '' };
      })
    );
  };

  const updateItem = (idx, field, value) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };
  const updateItemExtra = (idx, key, value) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, extra: { ...it.extra, [key]: value } } : it)));
  };

  // On mobile this also opens the new row's tab immediately - there'd be no
  // other way to reach it, since the mobile layout only ever shows the one
  // active particular's fields (see the isMobile branch in the JSX below).
  const addRow = () => {
    setActiveItemIdx(items.length);
    setItems((prev) => [...prev, emptyItem()]);
  };
  const removeRow = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  // Clamp against the live items length so this never goes stale (e.g. after
  // the standard particulars list reloads from the server, or a custom row
  // is removed while its tab is open).
  const activeIdx = Math.min(activeItemIdx, Math.max(items.length - 1, 0));
  const activeItem = items[activeIdx];
  const activeParticular = activeItem ? findParticularForRow(activeItem, particulars) : null;
  const activeRowVariants = resolveVariantOptions(activeParticular);
  const removeActiveRow = () => {
    removeRow(activeIdx);
    setActiveItemIdx((i) => Math.max(0, i - 1));
  };

  // Mirrors the backend rule in deliveryNoteController.canEditVehiclePhoto:
  // anyone can add a photo while none exists yet; once one exists, only
  // Admin/Superadmin may replace or remove it. The server enforces this too,
  // so this is purely about showing the right controls, not real security.
  const canEditVehiclePhoto = !vehiclePhotoUrl || user?.role === 'admin' || user?.isSuperAdmin === true;

  const handlePhotoFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    setPhotoError('');
    setPhotoUploadedNotice('');
    if (!file) {
      setVehiclePhotoFile(null);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError('Photo is too large. Please choose an image under 5MB.');
      e.target.value = '';
      return;
    }
    setVehiclePhotoFile(file);
  };

  // Uploads immediately for an already-saved note (edit mode). In create
  // mode the file is uploaded automatically right after the note is created
  // (see handleSubmit) since there's no note id to attach it to before that.
  const handleUploadPhotoNow = async () => {
    if (!vehiclePhotoFile || !id) return;
    setPhotoError('');
    setPhotoUploadedNotice('');
    setPhotoUploading(true);
    try {
      const res = await deliveryNoteApi.uploadVehiclePhoto(id, vehiclePhotoFile);
      setVehiclePhotoUrl(res.data.vehiclePhoto?.url || null);
      setVehiclePhotoFile(null);
      if (photoInputRef.current) photoInputRef.current.value = '';
      setPhotoUploadedNotice('Vehicle photo saved.');
    } catch (err) {
      setPhotoError(err.response?.data?.message || 'Failed to upload the photo. Please try again.');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!id) return;
    setPhotoError('');
    setPhotoUploadedNotice('');
    setPhotoUploading(true);
    try {
      await deliveryNoteApi.removeVehiclePhoto(id);
      setVehiclePhotoUrl(null);
      setVehiclePhotoFile(null);
      if (photoInputRef.current) photoInputRef.current.value = '';
      setPhotoUploadedNotice('Vehicle photo removed.');
    } catch (err) {
      setPhotoError(err.response?.data?.message || 'Failed to remove the photo. Please try again.');
    } finally {
      setPhotoUploading(false);
    }
  };

  // Same rule as canEditVehiclePhoto, mirrored for the receiver photo.
  const canEditReceiverPhoto = !receiverPhotoUrl || user?.role === 'admin' || user?.isSuperAdmin === true;

  const handleReceiverPhotoFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    setReceiverPhotoError('');
    setReceiverPhotoUploadedNotice('');
    if (!file) {
      setReceiverPhotoFile(null);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setReceiverPhotoError('Photo is too large. Please choose an image under 5MB.');
      e.target.value = '';
      return;
    }
    setReceiverPhotoFile(file);
  };

  const handleUploadReceiverPhotoNow = async () => {
    if (!receiverPhotoFile || !id) return;
    setReceiverPhotoError('');
    setReceiverPhotoUploadedNotice('');
    setReceiverPhotoUploading(true);
    try {
      const res = await deliveryNoteApi.uploadReceiverPhoto(id, receiverPhotoFile);
      setReceiverPhotoUrl(res.data.receiverPhoto?.url || null);
      setReceiverPhotoFile(null);
      if (receiverPhotoInputRef.current) receiverPhotoInputRef.current.value = '';
      setReceiverPhotoUploadedNotice('Receiver photo saved.');
    } catch (err) {
      setReceiverPhotoError(err.response?.data?.message || 'Failed to upload the photo. Please try again.');
    } finally {
      setReceiverPhotoUploading(false);
    }
  };

  const handleRemoveReceiverPhoto = async () => {
    if (!id) return;
    setReceiverPhotoError('');
    setReceiverPhotoUploadedNotice('');
    setReceiverPhotoUploading(true);
    try {
      await deliveryNoteApi.removeReceiverPhoto(id);
      setReceiverPhotoUrl(null);
      setReceiverPhotoFile(null);
      if (receiverPhotoInputRef.current) receiverPhotoInputRef.current.value = '';
      setReceiverPhotoUploadedNotice('Receiver photo removed.');
    } catch (err) {
      setReceiverPhotoError(err.response?.data?.message || 'Failed to remove the photo. Please try again.');
    } finally {
      setReceiverPhotoUploading(false);
    }
  };

  // Server-side OCR (backend/controllers/aadhaarController.js) - the photo is
  // uploaded to Cloudinary and read with Tesseract on the server, which is
  // both more reliable than running OCR in-browser on whatever the phone's
  // camera/CPU can manage, and lets the photo itself be kept on file. Never
  // auto-submits - the extracted text just pre-fills the fields above for the
  // staff member to review. Reports back with a single success/fail line
  // rather than a multi-branch explanation of exactly what was/wasn't found.
  const handleAadhaarScan = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setAadhaarError('');
    setAadhaarNotice('');
    setScanningAadhaar(true);
    try {
      const res = await customerApi.scanAadhaar(file);
      const { name, address, phone, found } = res.data;
      if (!found) {
        setAadhaarError('Scan not successful. Please enter the details manually.');
        return;
      }
      setNewCustomer((prev) => ({
        ...prev,
        name: name || prev.name,
        address: address || prev.address,
        phone: phone || prev.phone,
      }));
      // Aadhaar cards print Name and Address but never a mobile number, so
      // Phone can never be auto-filled from the card itself - say so plainly
      // rather than leaving it blank with no explanation. Address is also
      // called out separately since OCR quality varies photo to photo.
      const missing = [];
      if (!name) missing.push('Name');
      if (!address) missing.push('Address');
      if (!phone) missing.push('Phone');
      if (missing.length === 0) {
        setAadhaarNotice('Scan successful. Name, Phone and Address filled in - please review before saving.');
      } else if (missing.length === 1 && missing[0] === 'Phone') {
        setAadhaarNotice('Scan successful. Aadhaar cards do not print a mobile number - please enter Phone manually.');
      } else {
        setAadhaarNotice(
          `Scan successful. ${missing.join(' and ')} could not be read${missing.includes('Phone') ? ' (Phone is never printed on an Aadhaar card)' : ''} - please fill ${missing.length > 1 ? 'them' : 'it'} in manually.`
        );
      }
    } catch (err) {
      setAadhaarError('Scan not successful. Please enter the details manually.');
    } finally {
      setScanningAadhaar(false);
    }
  };

  // printAfter drives where we land after a successful save: the Billing
  // list (plain "Save Delivery Note") or straight to the print view (the
  // "Save & Print" button below) - both create/edit notes reuse this exact
  // save logic, since a brand-new note has no id to print until it's saved.
  const saveNote = async (printAfter) => {
    setError('');

    const cleanItems = items
      .filter((it) => it.itemName.trim() && Number(it.quantity) > 0)
      .map((it) => ({
        itemName: it.itemName.trim(),
        no: it.no || '',
        particularId: it.particularId || null,
        quantity: Number(it.quantity),
        rate: Number(it.rate) || 0,
        extra: it.extra || {},
        perDayRate: Number(it.perDayRate) || 0,
        monthlyRate: Number(it.monthlyRate) || 0,
        dateTaken: it.dateTaken || null,
        dateReturned: it.dateReturned || null,
        selectedVariant: it.selectedVariant || '',
      }));

    if (cleanItems.length === 0) {
      setError(t('deliveryForm.errorAddItem'));
      return;
    }

    if (!isVehicleNumberProvided(vehicleNumber)) {
      setError(VEHICLE_REQUIRED_HELP);
      return;
    }
    if (!isValidVehicleNumber(vehicleNumber)) {
      setError(`Invalid vehicle number. ${VEHICLE_HELP}`);
      return;
    }

    const payload = {
      date,
      vehicleNumber,
      items: cleanItems,
      paymentStatus,
      paymentMode,
      upiRefNumber: paymentMode === 'GPay/UPI' ? upiRefNumber : '',
    };
    if (!isEdit) {
      if (useNewCustomer) {
        if (!newCustomer.name || !newCustomer.phone) {
          setError(t('deliveryForm.errorCustomerRequired'));
          return;
        }
        if (!isValidPhone(newCustomer.phone)) {
          setError(`Invalid customer phone number. ${PHONE_HELP}`);
          return;
        }
        payload.newCustomer = newCustomer;
      } else {
        if (!customerId) {
          setError(t('deliveryForm.errorSelectCustomer'));
          return;
        }
        payload.customerId = customerId;
      }
    }

    setSaving(true);
    try {
      if (isEdit) {
        await deliveryNoteApi.update(id, payload);
        navigate(printAfter ? `/billing/${id}/print` : '/billing');
      } else {
        const res = await deliveryNoteApi.create(payload);
        // Photo upload is a second request after the note exists (a file
        // can't ride inside the JSON create payload above). If it fails, the
        // delivery note itself is still saved fine - only the photo needs a
        // retry, from the Edit screen, so this must not block navigation.
        if (vehiclePhotoFile) {
          try {
            await deliveryNoteApi.uploadVehiclePhoto(res.data._id, vehiclePhotoFile);
          } catch (photoErr) {
            console.error('Vehicle photo upload failed:', photoErr);
          }
        }
        if (receiverPhotoFile) {
          try {
            await deliveryNoteApi.uploadReceiverPhoto(res.data._id, receiverPhotoFile);
          } catch (photoErr) {
            console.error('Receiver photo upload failed:', photoErr);
          }
        }
        navigate(printAfter ? `/billing/${res.data._id}/print` : '/billing');
      }
    } catch (err) {
      setError(err.response?.data?.message || t('deliveryForm.errorSave'));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    saveNote(false);
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{isEdit ? t('deliveryForm.editTitle') : t('deliveryForm.createTitle')}</h1>
        <BackButton fallbackTo="/billing" />
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      <form className="panel form" onSubmit={handleSubmit} onKeyDown={advanceOnEnter}>
        <div className="form-grid dn-top-grid">
          <div className="form-field">
            <label>{t('deliveryForm.dateLabel')}</label>
            <DateField value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="form-field">
            <label>{t('deliveryForm.vehicleLabel')}</label>
            <input
              placeholder="TN49CH8736"
              value={vehicleNumber}
              maxLength={13}
              required
              onChange={(e) => setVehicleNumber(sanitizeVehicleInput(e.target.value))}
            />
            {vehicleNumber && !isValidVehicleNumber(vehicleNumber) && (
              <span className="field-hint field-hint-error">{VEHICLE_HELP}</span>
            )}
            {!vehicleNumber && <span className="field-hint">{VEHICLE_REQUIRED_HELP}</span>}
          </div>

          {/* Hidden file input uses capture="environment" so tapping the button on a
              phone opens the camera directly instead of a generic file picker; desktop
              browsers ignore "capture" and fall back to a normal file dialog. */}
          <div className="form-field">
            <label>Vehicle Photo</label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={photoInputRef}
              style={{ display: 'none' }}
              onChange={handlePhotoFileChange}
            />
            {canEditVehiclePhoto ? (
              <button
                type="button"
                className="btn btn-photo-capture"
                onClick={() => photoInputRef.current?.click()}
              >
                📷 {vehiclePhotoUrl || vehiclePhotoFilePreview ? 'Retake / Upload Photo' : 'Capture / Upload Photo'}
              </button>
            ) : (
              <span className="field-hint">Only Admin/Superadmin can change this photo.</span>
            )}
          </div>
          <div className="form-field">
            <label>Receiver Photo</label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={receiverPhotoInputRef}
              style={{ display: 'none' }}
              onChange={handleReceiverPhotoFileChange}
            />
            {/* Receiver photo is only offered once a vehicle photo exists, so it
                always lands after the vehicle photo in the preview list below
                instead of the two appearing in whatever order they were clicked. */}
            {!(vehiclePhotoUrl || vehiclePhotoFilePreview) ? (
              <span className="field-hint">Upload the vehicle photo first.</span>
            ) : canEditReceiverPhoto ? (
              <button
                type="button"
                className="btn btn-photo-capture"
                onClick={() => receiverPhotoInputRef.current?.click()}
              >
                📷 {receiverPhotoUrl || receiverPhotoFilePreview ? 'Retake / Upload Photo' : 'Capture / Upload Photo'}
              </button>
            ) : (
              <span className="field-hint">Only Admin/Superadmin can change this photo.</span>
            )}
          </div>
          <div className="form-field">
            <label>{t('deliveryForm.paymentStatusLabel')}</label>
            <SelectField
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}
              options={[
                { value: 'Pending', label: t('billing.pending'), tone: 'negative' },
                { value: 'Paid', label: t('billing.paid'), tone: 'positive' },
              ]}
            />
          </div>
          <div className="form-field">
            <label>{t('voucher.paymentMode')}</label>
            <SelectField
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value)}
              options={[
                { value: 'Cash', label: 'Cash' },
                { value: 'GPay/UPI', label: 'GPay/UPI' },
                { value: 'IMPS', label: 'IMPS' },
                { value: 'RTGS', label: 'RTGS' },
                { value: 'NEFT', label: 'NEFT' },
              ]}
            />
          </div>
          {paymentMode === 'GPay/UPI' && (
            <div className="form-field">
              <label>{t('voucher.upiRefNumber')}</label>
              <input value={upiRefNumber} onChange={(e) => setUpiRefNumber(e.target.value)} />
            </div>
          )}
        </div>

        {/* Both previews live in a single compact row, Vehicle always on the
            left and Receiver always on the right (matching the order they're
            captured in) - previously each was its own full-width block
            stacked one above the other, which left a lot of empty space
            beside every photo and pushed the rest of the form far down the
            page for no reason. */}
        {((vehiclePhotoUrl || vehiclePhotoFilePreview) || (receiverPhotoUrl || receiverPhotoFilePreview)) && (
          <div className="photo-previews-row">
            {(vehiclePhotoUrl || vehiclePhotoFilePreview) && (
              <div className="photo-preview-item">
                <span className="photo-preview-label">Vehicle Photo</span>
                <img src={vehiclePhotoFilePreview || vehiclePhotoUrl} alt="Vehicle" className="vehicle-photo-preview" />
                <div className="vehicle-photo-actions">
                  {isEdit && vehiclePhotoFile && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={photoUploading}
                      onClick={handleUploadPhotoNow}
                    >
                      {photoUploading ? 'Uploading...' : vehiclePhotoUrl ? 'Save New Photo' : 'Save Photo'}
                    </button>
                  )}
                  {isEdit && vehiclePhotoUrl && !vehiclePhotoFile && canEditVehiclePhoto && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={photoUploading}
                      onClick={handleRemovePhoto}
                    >
                      Remove Photo
                    </button>
                  )}
                  {!isEdit && vehiclePhotoFile && (
                    <span className="field-hint">Saved automatically once this note is created.</span>
                  )}
                </div>
                {photoError && <span className="field-hint field-hint-error">{photoError}</span>}
                {photoUploadedNotice && <span className="field-hint">{photoUploadedNotice}</span>}
              </div>
            )}

            {(receiverPhotoUrl || receiverPhotoFilePreview) && (
              <div className="photo-preview-item">
                <span className="photo-preview-label">Receiver Photo</span>
                <img src={receiverPhotoFilePreview || receiverPhotoUrl} alt="Receiver" className="vehicle-photo-preview" />
                <div className="vehicle-photo-actions">
                  {isEdit && receiverPhotoFile && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={receiverPhotoUploading}
                      onClick={handleUploadReceiverPhotoNow}
                    >
                      {receiverPhotoUploading ? 'Uploading...' : receiverPhotoUrl ? 'Save New Photo' : 'Save Photo'}
                    </button>
                  )}
                  {isEdit && receiverPhotoUrl && !receiverPhotoFile && canEditReceiverPhoto && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={receiverPhotoUploading}
                      onClick={handleRemoveReceiverPhoto}
                    >
                      Remove Photo
                    </button>
                  )}
                  {!isEdit && receiverPhotoFile && (
                    <span className="field-hint">Saved automatically once this note is created.</span>
                  )}
                </div>
                {receiverPhotoError && <span className="field-hint field-hint-error">{receiverPhotoError}</span>}
                {receiverPhotoUploadedNotice && <span className="field-hint">{receiverPhotoUploadedNotice}</span>}
              </div>
            )}
          </div>
        )}

        {!isEdit && (
          <div className="customer-block">
            <div className="toggle-row">
              <label>
                <input type="radio" checked={useNewCustomer} onChange={() => setUseNewCustomer(true)} />{' '}
                {t('deliveryForm.newCustomer')}
              </label>
              <label>
                <input type="radio" checked={!useNewCustomer} onChange={() => setUseNewCustomer(false)} />{' '}
                {t('deliveryForm.existingCustomer')}
              </label>
            </div>
            {useNewCustomer ? (
              <div className="form-grid">
                <div className="form-field">
                  <label>&nbsp;</label>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    ref={aadhaarInputRef}
                    style={{ display: 'none' }}
                    onChange={handleAadhaarScan}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={scanningAadhaar}
                    onClick={() => aadhaarInputRef.current?.click()}
                  >
                    {scanningAadhaar ? 'Scanning...' : '📷 Scan Aadhaar'}
                  </button>
                  {aadhaarError && <span className="field-hint field-hint-error">{aadhaarError}</span>}
                  {aadhaarNotice && <span className="field-hint">{aadhaarNotice}</span>}
                </div>
                <div className="form-field">
                  <label>{t('deliveryForm.customerName')}</label>
                  {/* Item 4 (2026-09-15): typing/picking a name that matches an
                      already-saved customer now fills in their Phone and Address
                      automatically (only when those boxes are still empty, so it
                      never overwrites something the user already typed). */}
                  <input
                    list="rsa-customer-name-suggestions"
                    value={newCustomer.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      const match = customers.find((c) => c.name?.trim().toLowerCase() === name.trim().toLowerCase());
                      setNewCustomer((prev) => ({
                        ...prev,
                        name,
                        phone: !prev.phone && match ? match.phone || '' : prev.phone,
                        address: !prev.address && match ? match.address || '' : prev.address,
                      }));
                    }}
                    required
                  />
                  <datalist id="rsa-customer-name-suggestions">
                    {customers.map((c) => (
                      <option key={c._id} value={c.name} />
                    ))}
                  </datalist>
                </div>
                <div className="form-field">
                  <label>{t('deliveryForm.customerPhone')}</label>
                  <input
                    value={newCustomer.phone}
                    maxLength={13}
                    placeholder="9876543210"
                    onChange={(e) => setNewCustomer({ ...newCustomer, phone: sanitizePhoneInput(e.target.value) })}
                    required
                  />
                  {newCustomer.phone && !isValidPhone(newCustomer.phone) && (
                    <span className="field-hint field-hint-error">{PHONE_HELP}</span>
                  )}
                </div>
                <div className="form-field">
                  <label>{t('deliveryForm.customerAddress')}</label>
                  <input
                    value={newCustomer.address}
                    onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
                  />
                </div>
              </div>
            ) : (
              <div className="form-field">
                <label>{t('deliveryForm.selectCustomer')}</label>
                <SelectField
                  searchable
                  required
                  placeholder={t('deliveryForm.selectPlaceholder')}
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  options={customers.map((c) => ({ value: c._id, label: `${c.name} (${c.phone})` }))}
                />
              </div>
            )}
          </div>
        )}

        <h2>{t('deliveryForm.particulars')}</h2>
        <p className="amount-display" style={{ marginTop: 0 }}>
          Tip: leave Per-Day Rate blank for a normal item. Fill it in (with Date Taken / Date Returned) to bill
          rental equipment like scaffolding or pipes by the day instead of a flat rate.
        </p>

        {isMobile ? (
          /* Phone layout: one particular at a time. A horizontally-swipeable
             strip of tabs (one per pad row, in the exact order they print on
             the pad, plus one per custom row) replaces the old stacked-card
             table - previously every row's full field set rendered one after
             another, which meant scrolling past ~20 rows x 8 fields just to
             reach the one the staff member actually needed to fill in.
             Tapping a tab swaps the card below to that row; a filled dot
             marks any tab that already has a quantity entered, so progress
             stays visible while flipping between tabs. */
          <div className="particulars-mobile">
            <div className="particulars-tabs" role="tablist" aria-label={t('deliveryForm.particulars')}>
              {items.map((it, idx) => {
                const label = it.itemName?.trim() || `${t('deliveryForm.newItemTab')} ${idx + 1}`;
                const filled = Number(it.quantity) > 0;
                return (
                  <button
                    key={idx}
                    type="button"
                    role="tab"
                    aria-selected={activeIdx === idx}
                    className={`particulars-tab${activeIdx === idx ? ' active' : ''}${filled ? ' filled' : ''}`}
                    onClick={() => setActiveItemIdx(idx)}
                    title={label}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {activeItem && (
              <div className="particulars-card">
                <div className="particulars-card-header">
                  <span className="particulars-card-no">
                    {t('deliveryForm.colNo')} {displayNumbers[activeIdx]}
                  </span>
                  <span className="particulars-card-amount">{formatCurrency(totals[activeIdx] || 0)}</span>
                </div>

                <div className="form-field">
                  <label>{t('deliveryForm.colItemName')}</label>
                  {activeItem.custom ? (
                    <input
                      value={activeItem.itemName}
                      placeholder="Item name"
                      onChange={(e) => updateItem(activeIdx, 'itemName', e.target.value)}
                    />
                  ) : (
                    <div className="particulars-card-title">{activeItem.itemName}</div>
                  )}
                </div>

                {activeRowVariants.length > 0 && (
                  <div className="form-field">
                    <label>{t('deliveryForm.variantLabel')}</label>
                    <SelectField
                      value={activeItem.selectedVariant || ''}
                      onChange={(e) => updateItemVariant(activeIdx, e.target.value)}
                      allowClear
                      clearLabel="Clear"
                      options={activeRowVariants.map((v) => ({ value: v.label, label: v.label }))}
                    />
                  </div>
                )}

                <div className="form-grid">
                  <div className="form-field">
                    <label>{t('deliveryForm.colQuantity')}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={activeItem.quantity}
                      onChange={(e) => updateItem(activeIdx, 'quantity', e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label>{t('deliveryForm.colRate')}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={activeItem.rate}
                      onChange={(e) => updateItem(activeIdx, 'rate', e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label>{t('deliveryForm.colPerDayRate')}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={activeItem.perDayRate}
                      onChange={(e) => updateItem(activeIdx, 'perDayRate', e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label>{t('deliveryForm.colMonthlyRate')}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={activeItem.monthlyRate}
                      onChange={(e) => updateItem(activeIdx, 'monthlyRate', e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label>{t('deliveryForm.colDateTaken')}</label>
                    <DateField value={activeItem.dateTaken} onChange={(e) => updateItem(activeIdx, 'dateTaken', e.target.value)} />
                  </div>
                  <div className="form-field">
                    <label>{t('deliveryForm.colDateReturned')}</label>
                    <DateField value={activeItem.dateReturned} onChange={(e) => updateItem(activeIdx, 'dateReturned', e.target.value)} />
                  </div>
                  {itemColumns.map((col) => (
                    <div className="form-field" key={col._id}>
                      <label>
                        {col.label}
                        {col.type === 'percent' ? ' (%)' : ''}
                      </label>
                      <input
                        type={col.type === 'text' ? 'text' : 'number'}
                        min={col.type === 'text' ? undefined : '0'}
                        step={col.type === 'text' ? undefined : '0.01'}
                        value={(activeItem.extra && activeItem.extra[col.key]) || ''}
                        onChange={(e) => updateItemExtra(activeIdx, col.key, e.target.value)}
                      />
                    </div>
                  ))}
                </div>

                {activeItem.custom && (
                  <button type="button" className="btn btn-sm btn-danger particulars-remove-btn" onClick={removeActiveRow}>
                    {t('deliveryForm.removeItem')}
                  </button>
                )}
              </div>
            )}

            <div className="particulars-grand-total">
              <span>{t('deliveryForm.grandTotal')}</span>
              <span>{formatCurrency(grandTotal)}</span>
            </div>
          </div>
        ) : (
        <table className="data-table items-table stack-on-mobile">
          <thead>
            <tr>
              <th style={{ width: 36 }}>{t('deliveryForm.colNo')}</th>
              <th style={{ width: 165 }}>{t('deliveryForm.colItemName')}</th>
              {/* Item 4 (2026-09-15): 95px cut off values like 1'6" x 1'0" -
                  widened so the variant dropdown's own text (and the option
                  list, which matches this trigger's width) is never clipped. */}
              <th style={{ width: 132 }}>Variant</th>
              <th style={{ width: 68 }}>{t('deliveryForm.colQuantity')}</th>
              <th style={{ width: 80 }}>{t('deliveryForm.colRate')}</th>
              <th style={{ width: 92 }}>{t('deliveryForm.colPerDayRate')}</th>
              <th style={{ width: 92 }}>{t('deliveryForm.colMonthlyRate')}</th>
              <th style={{ width: 112 }}>{t('deliveryForm.colDateTaken')}</th>
              <th style={{ width: 112 }}>{t('deliveryForm.colDateReturned')}</th>
              {itemColumns.map((col) => (
                <th key={col._id} style={{ width: 100 }}>
                  {col.label}
                  {col.type === 'percent' ? ' (%)' : ''}
                </th>
              ))}
              <th style={{ width: 32 }}></th>
              <th style={{ width: 85 }}>{t('deliveryForm.colAmount')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td data-label={t('deliveryForm.colNo')}>{displayNumbers[idx]}</td>
                <td className="item-name-cell" data-label={t('deliveryForm.colItemName')}>
                  {it.custom ? (
                    <input
                      value={it.itemName}
                      title={it.itemName}
                      onChange={(e) => updateItem(idx, 'itemName', e.target.value)}
                    />
                  ) : (
                    <span className="item-name-display" title={it.itemName}>
                      {it.itemName}
                    </span>
                  )}
                </td>
                <td data-label="Variant">
                  {(() => {
                    const matchedParticular = findParticularForRow(it, particulars);
                    const rowVariants = resolveVariantOptions(matchedParticular);
                    if (rowVariants.length === 0) return null;
                    return (
                      <SelectField
                        value={it.selectedVariant || ''}
                        onChange={(e) => updateItemVariant(idx, e.target.value)}
                        allowClear
                        clearLabel="Clear"
                        options={rowVariants.map((v) => ({ value: v.label, label: v.label }))}
                      />
                    );
                  })()}
                </td>
                <td data-label={t('deliveryForm.colQuantity')}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={it.quantity}
                    onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                  />
                </td>
                <td data-label={t('deliveryForm.colRate')}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={it.rate}
                    onChange={(e) => updateItem(idx, 'rate', e.target.value)}
                  />
                </td>
                <td data-label={t('deliveryForm.colPerDayRate')}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={it.perDayRate}
                    onChange={(e) => updateItem(idx, 'perDayRate', e.target.value)}
                  />
                </td>
                <td data-label={t('deliveryForm.colMonthlyRate')}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={it.monthlyRate}
                    onChange={(e) => updateItem(idx, 'monthlyRate', e.target.value)}
                  />
                </td>
                <td data-label={t('deliveryForm.colDateTaken')}>
                  <DateField value={it.dateTaken} onChange={(e) => updateItem(idx, 'dateTaken', e.target.value)} />
                </td>
                <td data-label={t('deliveryForm.colDateReturned')}>
                  <DateField value={it.dateReturned} onChange={(e) => updateItem(idx, 'dateReturned', e.target.value)} />
                </td>
                {itemColumns.map((col) => (
                  <td key={col._id} data-label={col.label}>
                    <input
                      type={col.type === 'text' ? 'text' : 'number'}
                      min={col.type === 'text' ? undefined : '0'}
                      step={col.type === 'text' ? undefined : '0.01'}
                      value={(it.extra && it.extra[col.key]) || ''}
                      onChange={(e) => updateItemExtra(idx, col.key, e.target.value)}
                    />
                  </td>
                ))}
                <td>
                  {it.custom && (
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => removeRow(idx)}>
                      x
                    </button>
                  )}
                </td>
                <td className="amount-cell" data-label={t('deliveryForm.colAmount')}>{formatCurrency(totals[idx] || 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={9 + itemColumns.length + 1} className="total-label">
                {t('deliveryForm.grandTotal')}
              </td>
              <td className="amount-cell total-amount">{formatCurrency(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
        )}
        <button type="button" className="btn btn-ghost add-custom-item-btn" onClick={addRow}>
          {t('deliveryForm.addCustomItem')}
        </button>

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/billing')}>
            {t('deliveryForm.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? t('deliveryForm.saving') : t('deliveryForm.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
