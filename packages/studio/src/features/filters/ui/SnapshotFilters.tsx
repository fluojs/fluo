import type { Dispatch } from 'react';
import type { PlatformDiagnosticSeverity, PlatformReadinessStatus } from '../../../contracts.js';
import type { StudioDashboardState } from '../../../entities/studio/model.js';
import type { StudioAction } from '../../live-connection/model/reducer.js';

const readinessOptions: PlatformReadinessStatus[] = ['ready', 'degraded', 'not-ready'];
const severityOptions: PlatformDiagnosticSeverity[] = ['error', 'warning', 'info'];

interface SnapshotFiltersProps {
  dispatch: Dispatch<StudioAction>;
  filter: StudioDashboardState['filter'];
}

/**
 * Provides Snapshot Filters behavior for the Studio devtool.
 */
export function SnapshotFilters({ dispatch, filter }: SnapshotFiltersProps) {
  return (
    <section className="card filter-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Static graph controls</p>
          <h2>Search and filtering</h2>
        </div>
      </div>
      <label>
        Search component/diagnostic
        <input
          id="search"
          onChange={(event) => dispatch({ query: event.target.value, type: 'filter-query' })}
          placeholder="e.g. redis.default or QUEUE_DEPENDENCY_NOT_READY"
          type="text"
          value={filter.query}
        />
      </label>

      <div className="filter-row">
        <span>Component readiness</span>
        {readinessOptions.map((status) => (
          <label key={status}>
            <input
              checked={filter.readinessStatuses.includes(status)}
              data-readiness={status}
              id={`readiness-${status}`}
              onChange={() => dispatch({ readiness: status, type: 'filter-readiness-toggle' })}
              type="checkbox"
            />{' '}
            {status}
          </label>
        ))}
      </div>

      <div className="filter-row">
        <span>Diagnostic severity</span>
        {severityOptions.map((severity) => (
          <label key={severity}>
            <input
              checked={filter.severities.includes(severity)}
              data-severity={severity}
              id={`severity-${severity}`}
              onChange={() => dispatch({ severity, type: 'filter-severity-toggle' })}
              type="checkbox"
            />{' '}
            {severity}
          </label>
        ))}
      </div>
    </section>
  );
}
