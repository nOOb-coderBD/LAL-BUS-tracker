import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BusFront,
  Download,
  Edit3,
  FileCheck2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Square,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api, ErrorMessage, Loading, post } from '../api';
import type { Collection, Trip } from '../types';

type Row = { _id: string; [key: string]: unknown };
type Resource = 'buses' | 'routes' | 'schedules';
type Tab = Resource | 'drivers' | 'trips' | 'audit';
type Choice = { value: string; label: string };
type Field = {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'select' | 'multi' | 'checkbox' | 'time' | 'days';
  required?: boolean;
  choices?: Choice[];
  default?: string | boolean;
};
type FormValues = Record<string, string | boolean | string[]>;
const statuses = [
  { value: 'NEEDS_ADMIN_VERIFICATION', label: 'Needs admin verification' },
  { value: 'VERIFIED', label: 'Verified by administrator' },
];
const busTypes = ['UNKNOWN', 'SINGLE_DECKER', 'DOUBLE_DECKER', 'OTHER'].map((value) => ({
  value,
  label: value.replaceAll('_', ' '),
}));
const text = (value: unknown) => (value == null ? '' : String(value));
function asIds(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}
function download(name: string, content: string, type = 'application/json') {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 500);
}

export function Admin() {
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>('buses');
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormValues>({});
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [importText, setImportText] = useState('');
  const routes = useQuery({
    queryKey: ['admin-routes'],
    queryFn: () => api<Collection<Row>>('/admin/routes?limit=500'),
  });
  const buses = useQuery({
    queryKey: ['admin-buses'],
    queryFn: () => api<Collection<Row>>('/admin/buses?limit=500'),
  });
  const drivers = useQuery({
    queryKey: ['admin-drivers'],
    queryFn: () => api<Collection<Row>>('/admin/drivers?limit=500'),
  });
  const schedules = useQuery({
    queryKey: ['admin-schedules'],
    queryFn: () => api<Collection<Row>>('/admin/schedules?limit=500'),
  });
  const trips = useQuery({
    queryKey: ['admin-trips'],
    queryFn: () => api<Collection<Trip>>('/trips/active?limit=100'),
    refetchInterval: 15_000,
  });
  const audit = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => api<Collection<Row>>('/admin/audit?limit=100'),
    enabled: tab === 'audit',
  });
  const routeChoices =
    routes.data?.items.map((row) => ({ value: row._id, label: text(row.nameBn) })) || [];
  const driverChoices =
    drivers.data?.items.map((row) => ({
      value: row._id,
      label: `${text(row.name)} · ${text(row.driverIdentifier)}`,
    })) || [];
  const busChoices =
    buses.data?.items.map((row) => ({
      value: row._id,
      label: `${text(row.displayNameBn)}${row.isDemo ? ' · DEMO' : ''}`,
    })) || [];
  const fields: Record<Resource, Field[]> = {
    buses: [
      { key: 'displayNameBn', label: 'বাসের প্রদর্শিত নাম · Bus name', required: true },
      { key: 'displayNameEn', label: 'English display name (optional)' },
      { key: 'fleetNumber', label: 'Confirmed fleet number · leave blank if unknown' },
      { key: 'registrationNumber', label: 'Confirmed registration number (optional)' },
      { key: 'busType', label: 'Bus type', type: 'select', choices: busTypes, default: 'UNKNOWN' },
      {
        key: 'routeIds',
        label: 'Assigned routes · hold Ctrl/⌘ to select several',
        type: 'multi',
        choices: routeChoices,
      },
      {
        key: 'assignedDriverIds',
        label: 'Assigned driver accounts',
        type: 'multi',
        choices: driverChoices,
      },
      { key: 'active', label: 'Active in fleet', type: 'checkbox', default: true },
      { key: 'approved', label: 'Approved for driver trips', type: 'checkbox', default: false },
    ],
    routes: [
      { key: 'nameBn', label: 'রুটের নাম · Bengali route name', required: true },
      { key: 'slug', label: 'Unique English slug (lowercase-with-hyphens)', required: true },
      { key: 'subtitle', label: 'Route subtitle / destination' },
      {
        key: 'routeUpText',
        label: 'UP stop description · preserve source order',
        type: 'textarea',
      },
      {
        key: 'routeDownText',
        label: 'DOWN stop description · preserve source order',
        type: 'textarea',
      },
      {
        key: 'status',
        label: 'Review status',
        type: 'select',
        choices: statuses,
        default: 'NEEDS_ADMIN_VERIFICATION',
      },
    ],
    schedules: [
      { key: 'routeId', label: 'Route', type: 'select', choices: routeChoices, required: true },
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        choices: [
          { value: 'UP', label: 'UP · আপ' },
          { value: 'DOWN', label: 'DOWN · ডাউন' },
        ],
        default: 'UP',
      },
      {
        key: 'departureTime',
        label: 'Scheduled departure · Asia/Dhaka',
        type: 'time',
        required: true,
      },
      { key: 'departurePlace', label: 'Departure place (optional)' },
      {
        key: 'busId',
        label: 'Confirmed physical bus (optional)',
        type: 'select',
        choices: busChoices,
      },
      { key: 'busType', label: 'Source bus type (optional)' },
      { key: 'vehicleNumber', label: 'Source vehicle number (optional)' },
      {
        key: 'daysOfWeek',
        label: 'Confirmed service days · 0 Sunday to 6 Saturday, comma-separated; blank = unknown',
        type: 'days',
      },
      { key: 'notes', label: 'Notes / variants', type: 'textarea' },
      { key: 'isStaffOnly', label: 'Staff-only service', type: 'checkbox', default: false },
      {
        key: 'status',
        label: 'Review status',
        type: 'select',
        choices: statuses,
        default: 'NEEDS_ADMIN_VERIFICATION',
      },
    ],
  };
  const resource = ['buses', 'routes', 'schedules'].includes(tab) ? (tab as Resource) : null;
  const current =
    tab === 'buses'
      ? buses
      : tab === 'routes'
        ? routes
        : tab === 'schedules'
          ? schedules
          : tab === 'drivers'
            ? drivers
            : audit;
  function changeTab(next: Tab) {
    setTab(next);
    setEditing(null);
    setCreating(false);
    setError(null);
    setSuccess('');
  }
  function open(row: Row | null) {
    if (!resource) return;
    const values: FormValues = {};
    for (const field of fields[resource]) {
      const value = row?.[field.key];
      values[field.key] =
        field.type === 'multi'
          ? asIds(value)
          : field.type === 'checkbox'
            ? Boolean(value ?? field.default ?? false)
            : field.type === 'days'
              ? Array.isArray(value)
                ? value.join(',')
                : ''
              : text(value ?? field.default ?? '');
    }
    setForm(values);
    setEditing(row);
    setCreating(true);
    setError(null);
  }
  function payload(values: FormValues) {
    if (!resource) return {};
    const result: Record<string, unknown> = {};
    for (const field of fields[resource]) {
      const value = values[field.key];
      if (field.type === 'multi') result[field.key] = value || [];
      else if (field.type === 'checkbox') result[field.key] = Boolean(value);
      else if (field.type === 'days') {
        const days = text(value).trim();
        if (days && !/^[0-6](\s*,\s*[0-6])*$/.test(days))
          throw new Error(
            'Service days must be comma-separated integers 0–6, or blank for unknown.',
          );
        result[field.key] = days ? [...new Set(days.split(',').map(Number))] : null;
      } else result[field.key] = text(value).trim() || null;
    }
    return result;
  }
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['admin-buses'] }),
      client.invalidateQueries({ queryKey: ['admin-routes'] }),
      client.invalidateQueries({ queryKey: ['admin-schedules'] }),
      client.invalidateQueries({ queryKey: ['admin-drivers'] }),
      client.invalidateQueries({ queryKey: ['admin-audit'] }),
      client.invalidateQueries({ queryKey: ['routes'] }),
      client.invalidateQueries({ queryKey: ['stats'] }),
    ]);
  }
  async function perform(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setSuccess('');
    try {
      await action();
      setSuccess(message);
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!resource) return;
    await perform(async () => {
      const body = payload(form);
      await api(`/admin/${resource}${editing ? `/${editing._id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setCreating(false);
    }, 'Record saved.');
  }
  async function remove(row: Row) {
    if (
      !resource ||
      !window.confirm(
        'Delete this record? Source seed stays unchanged; this database record will be removed.',
      )
    )
      return;
    await perform(
      () => api(`/admin/${resource}/${row._id}`, { method: 'DELETE' }),
      'Record deleted.',
    );
  }
  async function importRecords() {
    if (!resource) return;
    await perform(async () => {
      const parsed: unknown = JSON.parse(importText);
      if (!Array.isArray(parsed) || parsed.length > 500)
        throw new Error('Supply a JSON array of at most 500 records.');
      let imported = 0;
      try {
        for (const raw of parsed) {
          if (!raw || typeof raw !== 'object') throw new Error('Every record must be an object.');
          const value: Record<string, unknown> = {};
          for (const field of fields[resource])
            if (field.key in raw) value[field.key] = (raw as Record<string, unknown>)[field.key];
          await post(`/admin/${resource}`, value);
          imported++;
        }
      } catch (err) {
        throw new Error(
          `${imported} records created before import stopped: ${err instanceof Error ? err.message : 'invalid record'}`,
        );
      }
      setImportText('');
    }, 'JSON records imported.');
  }
  function csvExport() {
    const rows = current.data?.items || [];
    const keys = Array.from(new Set(rows.flatMap(Object.keys)));
    const cell = (v: unknown) =>
      `"${(typeof v === 'object' ? JSON.stringify(v) : text(v)).replaceAll('"', '""')}"`;
    download(
      `lal-${tab}.csv`,
      [
        keys.map(cell).join(','),
        ...rows.map((row) => keys.map((key) => cell(row[key])).join(',')),
      ].join('\r\n'),
      'text/csv;charset=utf-8',
    );
  }
  return (
    <div className="container section">
      <div className="page-heading">
        <div>
          <p className="section-kicker">TRANSPORT OPERATIONS</p>
          <h1>প্রশাসকের ড্যাশবোর্ড</h1>
          <p>Verified records, approved drivers, safer trips.</p>
        </div>
        <div className="header-actions">
          <button
            className="button secondary small"
            onClick={() =>
              void perform(async () => {
                const data = await api('/admin/export');
                download('lal-transport-export.json', JSON.stringify(data, null, 2));
              }, 'Export downloaded.')
            }
          >
            <Download size={16} /> Export JSON
          </button>
          <button
            className="icon-button"
            aria-label="Refresh administration data"
            onClick={() => void refresh()}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>
      <div className="admin-tabs" role="tablist" aria-label="Administration sections">
        {(
          [
            ['buses', 'বাস · Buses'],
            ['drivers', 'চালক · Drivers'],
            ['routes', 'রুট · Routes'],
            ['schedules', 'সময়সূচি'],
            ['trips', 'Live trips'],
            ['audit', 'Audit log'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'active' : ''}
            onClick={() => changeTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorMessage error={error || current.error} />
      {success && (
        <div className="notice" role="status">
          <FileCheck2 size={19} />
          {success}
        </div>
      )}
      {tab === 'drivers' ? (
        <section className="panel">
          <div className="panel-header">
            <h2>
              <Users size={20} /> Driver approvals & assignments
            </h2>
          </div>
          <div className="notice slim">
            Staff accounts are created through the protected invitation CLI. Approving here grants
            trip access only to the selected approved buses. Revocation ends the driver’s active
            trip.
          </div>
          {drivers.isPending ? (
            <Loading />
          ) : (
            <div className="driver-approval-list">
              {drivers.data?.items.map((driver) => (
                <DriverApproval
                  key={driver._id}
                  driver={driver}
                  buses={buses.data?.items || []}
                  busy={busy}
                  onSave={(approved, allowedBusIds) =>
                    void perform(
                      () =>
                        api(`/admin/drivers/${driver._id}/approval`, {
                          method: 'PATCH',
                          body: JSON.stringify({ approved, allowedBusIds }),
                        }),
                      approved
                        ? 'Driver approval and assignments saved.'
                        : 'Driver access revoked.',
                    )
                  }
                />
              ))}
            </div>
          )}
        </section>
      ) : tab === 'trips' ? (
        <section className="panel">
          <div className="panel-header">
            <h2>Active trips</h2>
          </div>
          {trips.data?.items.length ? (
            trips.data.items.map((trip) => (
              <div className="admin-trip-row" key={trip._id}>
                <div>
                  <strong>
                    {text(buses.data?.items.find((b) => b._id === trip.busId)?.displayNameBn) ||
                      trip.busId}
                  </strong>
                  <p className="muted">
                    {text(routes.data?.items.find((r) => r._id === trip.routeId)?.nameBn)} ·{' '}
                    {trip.direction} · {trip.freshness}
                  </p>
                  {trip.isDemo && <span className="badge demo">DEVELOPMENT DEMO</span>}
                </div>
                <button
                  className="button danger small"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Force-end this active trip? This is recorded in the audit log.',
                      )
                    )
                      void perform(async () => {
                        await post(`/admin/trips/${trip._id}/end`);
                        await trips.refetch();
                      }, 'Trip ended by administrator.');
                  }}
                >
                  <Square size={15} /> End trip
                </button>
              </div>
            ))
          ) : (
            <div className="empty-state compact">
              <BusFront size={30} />
              <p>No active trips.</p>
            </div>
          )}
        </section>
      ) : tab === 'audit' ? (
        <section className="panel">
          <div className="panel-header">
            <h2>
              <ShieldCheck size={20} /> Audit trail
            </h2>
            <span className="muted">Latest 100 events</span>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time · Dhaka</th>
                  <th>Action</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {audit.data?.items.map((row) => (
                  <tr key={row._id}>
                    <td>
                      {new Date(text(row.timestamp)).toLocaleString('en-GB', {
                        timeZone: 'Asia/Dhaka',
                      })}
                    </td>
                    <td>{text(row.action)}</td>
                    <td className="mono">{text(row.target)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className={`admin-grid ${creating ? 'is-editing' : ''}`}>
          <section className="panel">
            <div className="panel-header">
              <h2>
                {tab === 'buses'
                  ? 'বাসের তালিকা'
                  : tab === 'routes'
                    ? 'রুটের তালিকা'
                    : 'সময়সূচির এন্ট্রি'}{' '}
                <span className="badge neutral">{current.data?.total ?? '—'}</span>
              </h2>
              <div className="header-actions">
                <button className="button secondary small" onClick={csvExport}>
                  <Download size={14} /> CSV
                </button>
                <button className="button primary small" onClick={() => open(null)}>
                  <Plus size={16} /> Add
                </button>
              </div>
            </div>
            {current.isPending ? (
              <Loading />
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{tab === 'schedules' ? 'Scheduled departure' : 'Name'}</th>
                      <th>{tab === 'buses' ? 'Fleet / approval' : 'Review status'}</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.data?.items.map((row) => (
                      <tr key={row._id}>
                        <td>
                          <strong>
                            {tab === 'buses'
                              ? text(row.displayNameBn)
                              : tab === 'routes'
                                ? text(row.nameBn)
                                : `${text(row.departureTime)} · ${text(row.direction)}`}
                          </strong>
                          <span className="table-secondary">
                            {tab === 'schedules'
                              ? routeChoices.find((r) => r.value === row.routeId)?.label
                              : tab === 'routes'
                                ? text(row.subtitle)
                                : text(row.busType)}
                          </span>
                          {Boolean(row.isDemo) && <span className="badge demo">DEMO</span>}
                        </td>
                        <td>
                          {tab === 'buses' ? (
                            <>
                              <span>{text(row.fleetNumber) || 'Number unknown'}</span>
                              <br />
                              <span className={`badge ${row.approved ? 'live' : 'warning'}`}>
                                {row.approved ? 'Approved' : 'Unapproved'}
                              </span>
                            </>
                          ) : (
                            <span
                              className={`badge ${row.status === 'VERIFIED' ? 'live' : 'warning'}`}
                            >
                              {row.status === 'VERIFIED' ? 'Reviewed' : 'Needs confirmation'}
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="icon-button"
                              onClick={() => open(row)}
                              aria-label={`Edit ${text(row.nameBn || row.displayNameBn || row.departureTime)}`}
                            >
                              <Edit3 size={16} />
                            </button>
                            <button
                              className="icon-button"
                              disabled={busy}
                              onClick={() => void remove(row)}
                              aria-label={`Delete ${text(row.nameBn || row.displayNameBn || row.departureTime)}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {current.data?.items.length === 0 && (
                  <div className="empty-state compact">
                    No records yet. Add a verified record to begin.
                  </div>
                )}
              </div>
            )}
            <details className="import-details">
              <summary>Import JSON records</summary>
              <p className="muted">
                Creates new records in the selected section. This is not an upsert. Keep supplied
                source seed imports on the idempotent CLI. Export first; partial failures report
                their created count.
              </p>
              <label className="field">
                JSON array
                <textarea
                  rows={5}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="[ … ]"
                />
              </label>
              <button
                className="button secondary small"
                disabled={busy || !importText.trim()}
                onClick={() => void importRecords()}
              >
                Import {tab}
              </button>
            </details>
          </section>
          {creating && resource && (
            <aside className="editor">
              <div className="panel-header">
                <h2>{editing ? 'Edit record' : 'New record'}</h2>
                <button
                  className="icon-button"
                  aria-label="Close editor"
                  onClick={() => setCreating(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <form className="form-stack" onSubmit={(event) => void save(event)}>
                {fields[resource].map((field) => (
                  <label
                    className={`field ${field.type === 'checkbox' ? 'checkbox-field' : ''}`}
                    key={field.key}
                  >
                    {field.type === 'checkbox' ? (
                      <>
                        <input
                          type="checkbox"
                          checked={Boolean(form[field.key])}
                          onChange={(e) => setForm({ ...form, [field.key]: e.target.checked })}
                        />
                        {field.label}
                      </>
                    ) : (
                      <>
                        {field.label}
                        {field.type === 'textarea' ? (
                          <textarea
                            rows={4}
                            value={text(form[field.key])}
                            onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                          />
                        ) : field.type === 'select' || field.type === 'multi' ? (
                          <select
                            required={field.required}
                            multiple={field.type === 'multi'}
                            value={
                              field.type === 'multi'
                                ? (form[field.key] as string[])
                                : text(form[field.key])
                            }
                            onChange={(e) =>
                              setForm({
                                ...form,
                                [field.key]:
                                  field.type === 'multi'
                                    ? Array.from(e.target.selectedOptions, (o) => o.value)
                                    : e.target.value,
                              })
                            }
                          >
                            {field.type !== 'multi' && (
                              <option value="">
                                {field.required ? 'Select…' : 'Unknown / unassigned'}
                              </option>
                            )}
                            {field.choices?.map((choice) => (
                              <option key={choice.value} value={choice.value}>
                                {choice.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            required={field.required}
                            type={field.type === 'time' ? 'time' : 'text'}
                            value={text(form[field.key])}
                            onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                          />
                        )}
                      </>
                    )}
                  </label>
                ))}
                <div className="notice slim">
                  Only mark records verified after checking with an authoritative source. Unknown
                  bus numbers, coordinates and days stay unknown.
                </div>
                <button className="button primary" disabled={busy} type="submit">
                  <Save size={17} /> {busy ? 'Saving…' : 'Save record'}
                </button>
              </form>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
function DriverApproval({
  driver,
  buses,
  busy,
  onSave,
}: {
  driver: Row;
  buses: Row[];
  busy: boolean;
  onSave: (approved: boolean, busIds: string[]) => void;
}) {
  const [ids, setIds] = useState(asIds(driver.allowedBusIds));
  return (
    <article className="driver-approval-row">
      <div>
        <strong>{text(driver.name)}</strong>
        <p className="muted">
          {text(driver.email)}
          <br />
          {text(driver.driverIdentifier)}
        </p>
        <span className={`badge ${driver.approvedAt ? 'live' : 'warning'}`}>
          {driver.approvedAt ? 'Approved driver' : 'Approval required'}
        </span>
        {Boolean(driver.isDemo) && <span className="badge demo">DEMO</span>}
      </div>
      <div>
        <label className="field">
          Allowed approved buses
          <select
            multiple
            aria-label={`Allowed buses for ${text(driver.name)}`}
            value={ids}
            onChange={(e) => setIds(Array.from(e.target.selectedOptions, (o) => o.value))}
          >
            {buses
              .filter((bus) => bus.active && bus.approved)
              .map((bus) => (
                <option key={bus._id} value={bus._id}>
                  {text(bus.displayNameBn)}
                </option>
              ))}
          </select>
        </label>
        <div className="row-actions">
          <button
            className="button primary small"
            disabled={busy}
            onClick={() => onSave(true, ids)}
          >
            Approve / save assignments
          </button>
          <button
            className="button ghost small"
            disabled={busy || !driver.approvedAt}
            onClick={() => onSave(false, [])}
          >
            Revoke access
          </button>
        </div>
      </div>
    </article>
  );
}
