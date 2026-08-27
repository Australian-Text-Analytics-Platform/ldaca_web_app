import { SelectItem } from '@/components/ui/select';
import { isInvalidAnnotationLabel } from '../annotationRowFilter';

interface InvalidAnnotationClassItemProps {
  /** Raw current cell value, or null when the cell is empty. */
  value: string | null;
  classOptions: readonly string[];
}

/**
 * Keeps a non-Codebook value visible inside an annotation or correction dropdown.
 * Radix Select renders an empty trigger when its value matches no item, so an existing cell
 * such as `P` would silently disappear; this item shows it in the same muted italic style used
 * by read-only cells and lets the coder replace it with a real class.
 */
export function InvalidAnnotationClassItem({
  value,
  classOptions,
}: InvalidAnnotationClassItemProps) {
  if (value === null || !isInvalidAnnotationLabel(value, classOptions)) return null;
  return (
    <SelectItem
      value={value}
      className="italic text-description"
      title="Not a Codebook class; treated as empty"
    >
      {value}
    </SelectItem>
  );
}
