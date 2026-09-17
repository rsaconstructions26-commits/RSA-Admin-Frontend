import React, { useEffect, useState } from 'react';
import { stockApi } from '../../api';
import { useLanguage } from '../../context/LanguageContext.jsx';
import BackButton from '../common/BackButton.jsx';
import SearchBox, { useSearch } from '../common/SearchBox.jsx';

// Per spec STOCK MANAGEMENT example: Steel Available 500, Used 85, Remaining 415.
export default function StockView() {
  const { t } = useLanguage();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery, filteredRows] = useSearch(rows, ['materialName', 'category']);

  useEffect(() => {
    stockApi
      .summary()
      .then((res) => setRows(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load stock'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('stock.title')}</h1>
        <BackButton />
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="panel">
        <div className="panel-header-row">
          <SearchBox value={query} onChange={setQuery} placeholder="Search stock..." />
        </div>
        {loading ? (
          <div className="page-loading">{t('stock.loading')}</div>
        ) : (
          <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('stock.material')}</th>
                <th>{t('stock.category')}</th>
                <th>{t('stock.opening')}</th>
                <th>{t('stock.purchased')}</th>
                <th>{t('stock.used')}</th>
                <th className="amount-cell">{t('stock.remaining')}</th>
                <th>{t('stock.status')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((m) => (
                <tr key={m.id} className={m.lowStock ? 'row-low-stock' : ''}>
                  <td>{m.materialName}</td>
                  <td>{m.category}</td>
                  <td>
                    {m.openingStock} {m.unit}
                  </td>
                  <td>
                    {m.quantityPurchased} {m.unit}
                  </td>
                  <td>
                    {m.quantityUsed} {m.unit}
                  </td>
                  <td className="amount-cell">
                    {m.remainingStock} {m.unit}
                  </td>
                  <td>
                    {m.lowStock ? (
                      <span className="badge badge-pending">{t('stock.lowStock')}</span>
                    ) : (
                      <span className="badge badge-paid">{t('stock.ok')}</span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-row">
                    {rows.length === 0 ? t('stock.noMaterials') : 'No materials match your search.'}
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
