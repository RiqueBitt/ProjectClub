import { useEffect, useState } from 'react';
import Modal from '../Modal.jsx';

// Item pedido: "ver mais" quando tem mais de 3 recados/depoimentos —
// abre isso, mostrando TODOS, paginado (100 por página, com botões de
// página 1/2/3...). Um componente genérico reaproveitado pelos dois
// (Recados e Depoimentos) em vez de duplicar a mesma lógica de
// paginação duas vezes — só muda o que cada item mostra por dentro
// (renderItem) e de onde os dados vêm (fetchPage).
export default function PaginatedListModal({ title, fetchPage, renderItem, emptyLabel, onClose }) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchPage(page)
      .then((d) => { setItems(d.items); setTotalPages(d.totalPages || 1); })
      .finally(() => setLoading(false));
  }, [page]);

  // Até 7 números de página visíveis, com "..." no meio pra listas
  // muito grandes — igual paginação de fórum/loja, sem precisar
  // mostrar 40 botões numa linha só se tiver 40 páginas.
  const pageNumbers = () => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const nums = new Set([1, 2, totalPages - 1, totalPages, page - 1, page, page + 1]);
    return [...nums].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  };

  return (
    <Modal title={title} onClose={onClose} width="480px">
      <div className="paginated-list-modal">
        {loading && <div className="dim paginated-list-loading">Carregando...</div>}
        {!loading && items.length === 0 && <div className="dim paginated-list-loading">{emptyLabel}</div>}
        {!loading && items.length > 0 && (
          <div className="paginated-list-items">{items.map(renderItem)}</div>
        )}
        {totalPages > 1 && (
          <div className="paginated-list-pager">
            <button className="btn-secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹</button>
            {pageNumbers().map((n, i, arr) => (
              <span key={n} className="paginated-list-pager-group">
                {i > 0 && n - arr[i - 1] > 1 && <span className="dim paginated-list-pager-ellipsis">…</span>}
                <button
                  className={`paginated-list-pager-btn ${n === page ? 'active' : ''}`}
                  onClick={() => setPage(n)}
                >
                  {n}
                </button>
              </span>
            ))}
            <button className="btn-secondary" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
