import { useState, useEffect } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { DataTable } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/status'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Flash, useFlash } from '@/components/shared/flash'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import {
  getInventory, addMedicine, deleteMedicine, updateAvailability,
} from '@/services/pharmacy-api'
import { STATUS_META, AVAILABILITY_STATUSES } from '@/services/pharmacy-data'
import { Plus, MoreHorizontal, Pencil, Trash2, Loader2 } from 'lucide-react'

const EMPTY_FORM = { name: '', generic: '', strength: '', dosageForm: 'Tablet', status: 'available' }

export default function PharmacyInventory() {
  const [rows, setRows] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [flashMsg, flash] = useFlash()

  // Add / edit dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)

  useEffect(() => {
    let alive = true
    getInventory().then((r) => alive && setRows(r)).catch(() => alive && setRows([]))
    return () => { alive = false }
  }, [])

  const openAdd = () => { setEditingId(null); setForm(EMPTY_FORM); setDialogOpen(true) }
  const openEdit = (m) => {
    setEditingId(m.id)
    setForm({ name: m.name, generic: m.generic, strength: m.strength, dosageForm: m.dosageForm, status: m.status })
    setDialogOpen(true)
  }

  const [submitting, setSubmitting] = useState(false)

  const submitForm = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { flash('Medicine name is required'); return }
    setSubmitting(true)
    try {
      if (editingId) {
        const updated = await updateAvailability(editingId, form.status)
        setRows((rs) => rs.map((m) => (m.id === editingId ? { ...m, ...form, ...updated, updated: 'just now' } : m)))
        flash(`Updated ${form.name}`)
      } else {
        const created = await addMedicine({
          name: form.name,
          generic: form.generic,
          strength: form.strength,
          dosageForm: form.dosageForm,
          status: form.status,
        })
        setRows((rs) => [created, ...rs])
        flash(`Added ${form.name}`)
      }
      setDialogOpen(false)
    } catch (err) {
      flash(err.message || 'Failed to save medicine')
    } finally {
      setSubmitting(false)
    }
  }

  const setAvailability = async (m, status) => {
    setRows((rs) => rs.map((r) => (r.id === m.id ? { ...r, status, updated: 'just now' } : r)))
    await updateAvailability(m.id, status)
    flash(`${m.name} → ${STATUS_META[status].label}`)
  }

  const remove = async (m) => {
    setRows((rs) => rs.filter((r) => r.id !== m.id))
    await deleteMedicine(m.id)
    flash(`Removed ${m.name}`)
  }

  const columns = [
    {
      key: 'name', header: 'Medicine', sortable: true, accessor: (r) => r.name,
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-semibold text-foreground">{r.name}</span>
          <span className="text-xs text-muted-foreground">{r.generic}</span>
        </div>
      ),
    },
    { key: 'strength', header: 'Strength', sortable: true, cell: (r) => <span className="text-sm tabular">{r.strength}</span> },
    { key: 'dosageForm', header: 'Dosage form', cell: (r) => <span className="text-sm text-muted-foreground">{r.dosageForm}</span> },
    {
      key: 'status', header: 'Availability', sortable: true, sortValue: (r) => r.status,
      cell: (r) => {
        const m = STATUS_META[r.status]
        return <StatusBadge tone={m.tone} size="sm">{m.label}</StatusBadge>
      },
    },
    { key: 'updated', header: 'Last updated', align: 'right', cell: (r) => <span className="text-xs text-muted-foreground">{r.updated}</span> },
  ]

  if (!rows) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading inventory…
      </div>
    )
  }

  const visible = statusFilter === 'all' ? rows : rows.filter((r) => r.status === statusFilter)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inventory"
        subtitle="Manage the medicines your pharmacy stocks and keep availability current."
        actions={
          <Button onClick={openAdd}>
            <Plus className="size-4" />
            Add medicine
          </Button>
        }
      />

      {flashMsg && <Flash message={flashMsg} />}

      <DataTable
        columns={columns}
        data={visible}
        getRowId={(r) => r.id}
        searchable
        searchPlaceholder="Search medicines…"
        searchAccessor={(r) => `${r.name} ${r.generic}`}
        pageSize={8}
        emptyTitle="No medicines"
        emptyDescription="Add a medicine or adjust your filters."
        toolbar={
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by availability"
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">All</option>
              {AVAILABILITY_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
        }
        rowActions={(r) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.name}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => openEdit(r)}>
                <Pencil /> Edit medicine
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Update availability</DropdownMenuLabel>
              {AVAILABILITY_STATUSES.map((s) => (
                <DropdownMenuItem key={s.value} onSelect={() => setAvailability(r, s.value)} disabled={r.status === s.value}>
                  {s.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="danger" onSelect={() => remove(r)}>
                <Trash2 /> Remove medicine
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit medicine' : 'Add medicine'}</DialogTitle>
            <DialogDescription>
              {editingId ? 'Update this medicine’s details.' : 'Add a medicine to your inventory.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForm} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-name">Medicine name</Label>
              <Input id="m-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Dolo 650" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="m-generic">Generic name</Label>
                <Input id="m-generic" value={form.generic} onChange={(e) => setForm((f) => ({ ...f, generic: e.target.value }))} placeholder="Paracetamol" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="m-strength">Strength</Label>
                <Input id="m-strength" value={form.strength} onChange={(e) => setForm((f) => ({ ...f, strength: e.target.value }))} placeholder="650 mg" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="m-form">Dosage form</Label>
                <Input id="m-form" value={form.dosageForm} onChange={(e) => setForm((f) => ({ ...f, dosageForm: e.target.value }))} placeholder="Tablet" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="m-status">Availability</Label>
                <select
                  id="m-status"
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className="h-10 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {AVAILABILITY_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {editingId ? 'Save changes' : 'Add medicine'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
