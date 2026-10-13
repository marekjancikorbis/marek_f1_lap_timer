import type { SectorComparison } from '@laptimer/timing';
import { formatDelta, formatLap } from '../lib/format';
import { SERIES } from './Charts';

/** A and B sector times side by side; the faster cell is marked, purple = route record. */
export function SectorTable({ rows, aLabel, bLabel }: { rows: SectorComparison[]; aLabel: string; bLabel: string }) {
  return (
    <table className="sector-table">
      <thead>
        <tr>
          <th scope="col">Sector</th>
          <th scope="col">
            <i style={{ background: SERIES.a }} />
            {aLabel}
          </th>
          <th scope="col">
            <i style={{ background: SERIES.b }} />
            {bLabel}
          </th>
          <th scope="col">Gap</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.k}>
            <th scope="row">S{r.k + 1}</th>
            <td className={`num ${r.faster === 'a' ? 'faster' : ''} ${r.aRecord ? 'record' : ''}`}>
              {formatLap(r.aMs)}
              {r.aRecord && <span className="visually-hidden"> (route record)</span>}
            </td>
            <td className={`num ${r.faster === 'b' ? 'faster' : ''} ${r.bRecord ? 'record' : ''}`}>
              {formatLap(r.bMs)}
              {r.bRecord && <span className="visually-hidden"> (route record)</span>}
            </td>
            <td className={`num gap ${r.diffMs < 0 ? 'a' : r.diffMs > 0 ? 'b' : ''}`}>{formatDelta(r.diffMs, 3)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
