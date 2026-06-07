/**
 * Report segment layout — renders only {children}, bypassing the parent
 * StationHeader. The StationHeader's `print-hide` class already suppresses it
 * from the print output, so this layout is intentionally minimal.
 */
export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
