import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "../../lib/cn";
import { Button } from "./button";
import { Select } from "./field";

const pageSizes = [10, 20, 50];

export function Pagination({
  page,
  pageCount,
  pageSize,
  total,
  label,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  label: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(total, page * pageSize);
  return (
    <nav
      className={cn("v-stack gap-3 border-t border-line pt-4 sm:h-stack sm:items-center")}
      aria-label={`Paginação de ${label}`}
    >
      <p className={cn("grow text-sm text-muted")}>
        {start}–{end} de {total} {label}
      </p>
      <label className={cn("h-stack items-center gap-2 text-sm font-medium")}>
        Por página
        <Select
          className="min-h-9 w-20 py-1"
          aria-label={`Quantidade de ${label} por página`}
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {pageSizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
      </label>
      <div className={cn("h-stack items-center gap-1")}>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Página anterior"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </Button>
        <span className={cn("min-w-20 text-center text-sm font-semibold")}>
          {page} de {Math.max(1, pageCount)}
        </span>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Próxima página"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
