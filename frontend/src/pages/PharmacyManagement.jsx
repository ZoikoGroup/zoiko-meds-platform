import { useState, useMemo } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DataTable } from '@/components/shared/data-table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Building2, CheckCircle2, AlertTriangle, XCircle, ShieldCheck, Ban, Trash2, Eye, Edit, Check, X, ShieldAlert, Plus } from 'lucide-react'

const initialPharmacies = [
  { id: '1', name: 'Meridian Care Pharmacy', license: 'LC-990812', city: 'New York', country: 'United States', status: 'Verified', availabilityScore: 98, lastUpdate: '2h ago' },
  { id: '2', name: 'West End Health Hub', license: 'LC-881273', city: 'London', country: 'United Kingdom', status: 'Pending', availabilityScore: 84, lastUpdate: '5h ago' },
  { id: '3', name: 'Apotheke am Tor', license: 'LC-772183', city: 'Berlin', country: 'Germany', status: 'Verified', availabilityScore: 96, lastUpdate: '1d ago' },
  { id: '4', name: 'Apex Meds Supply', license: 'LC-661273', city: 'New York', country: 'United States', status: 'Suspended', availabilityScore: 42, lastUpdate: '3d ago' },
  { id: '5', name: 'Delhi Pharma & Surgical', license: 'LC-551829', city: 'New Delhi', country: 'India', status: 'Verified', availabilityScore: 91, lastUpdate: '3h ago' },
  { id: '6', name: 'Sao Paulo Biopharma', license: 'LC-441293', city: 'Sao Paulo', country: 'Brazil', status: 'Pending', availabilityScore: 76, lastUpdate: '12h ago' },
  { id: '7', name: 'Tokyo Central Dispensary', license: 'LC-331289', city: 'Tokyo', country: 'Japan', status: 'Verified', availabilityScore: 99, lastUpdate: '1h ago' },
  { id: '8', name: 'Paris City Chemist', license: 'LC-221298', city: 'Paris', country: 'France', status: 'Verified', availabilityScore: 94, lastUpdate: '4h ago' }
]

export default function PharmacyManagement() {
  const [pharmacies, setPharmacies] = useState(initialPharmacies)
  const [statusFilter, setStatusFilter] = useState('All')
  const [countryFilter, setCountryFilter] = useState('All')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [selectedPharmacy, setSelectedPharmacy] = useState(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [isAddOpen, setIsAddOpen] = useState(false)

  // Form states for adding new pharmacy
  const [newForm, setNewForm] = useState({ name: '', license: '', city: '', country: '', availabilityScore: 100 })

  const countries = useMemo(() => {
    return ['All', ...new Set(pharmacies.map((p) => p.country))]
  }, [pharmacies])

  const filteredPharmacies = useMemo(() => {
    return pharmacies.filter((p) => {
      const matchStatus = statusFilter === 'All' || p.status === statusFilter
      const matchCountry = countryFilter === 'All' || p.country === countryFilter
      return matchStatus && matchCountry
    })
  }, [pharmacies, statusFilter, countryFilter])

  const handleToggleSelect = (id) => {
    const next = new Set(selectedIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setSelectedIds(next)
  }

  const handleSelectAll = () => {
    if (selectedIds.size === filteredPharmacies.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredPharmacies.map((p) => p.id)))
    }
  }

  const handleBulkApprove = () => {
    setPharmacies((prev) =>
      prev.map((p) => (selectedIds.has(p.id) ? { ...p, status: 'Verified' } : p))
    )
    setSelectedIds(new Set())
  }

  const handleBulkReject = () => {
    setPharmacies((prev) =>
      prev.map((p) => (selectedIds.has(p.id) ? { ...p, status: 'Suspended' } : p))
    )
    setSelectedIds(new Set())
  }

  const handleToggleSuspend = (id) => {
    setPharmacies((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        const nextStatus = p.status === 'Suspended' ? 'Verified' : 'Suspended'
        return { ...p, status: nextStatus }
      })
    )
  }

  const handleAddPharmacy = (e) => {
    e.preventDefault()
    if (!newForm.name || !newForm.license) return
    const newEntry = {
      id: String(pharmacies.length + 1),
      ...newForm,
      status: 'Pending',
      lastUpdate: 'Just now'
    }
    setPharmacies((prev) => [newEntry, ...prev])
    setIsAddOpen(false)
    setNewForm({ name: '', license: '', city: '', country: '', availabilityScore: 100 })
  }

  const columns = [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          checked={selectedIds.size > 0 && selectedIds.size === filteredPharmacies.length}
          onChange={handleSelectAll}
          className="rounded border-border/80 accent-primary"
        />
      ),
      cell: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.id)}
          onChange={() => handleToggleSelect(row.id)}
          className="rounded border-border/80 accent-primary"
        />
      )
    },
    {
      key: 'name',
      header: 'Pharmacy Name',
      sortable: true,
      cell: (row) => (
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Building2 className="size-4 text-muted-foreground shrink-0" />
          <span>{row.name}</span>
        </div>
      )
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      cell: (row) => {
        const severity = row.status === 'Verified' ? 'good' : row.status === 'Pending' ? 'warning' : 'critical'
        return <Badge variant={severity === 'good' ? 'default' : severity === 'warning' ? 'secondary' : 'destructive'}>{row.status}</Badge>
      }
    },
    {
      key: 'license',
      header: 'License Number',
      cell: (row) => <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{row.license}</code>
    },
    {
      key: 'city',
      header: 'Location',
      cell: (row) => <span className="text-muted-foreground">{row.city}, {row.country}</span>
    },
    {
      key: 'availabilityScore',
      header: 'Reliability Score',
      sortable: true,
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="w-16 bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full ${row.availabilityScore > 85 ? 'bg-success' : row.availabilityScore > 60 ? 'bg-warning' : 'bg-danger'}`}
              style={{ width: `${row.availabilityScore}%` }}
            />
          </div>
          <span className="font-semibold text-xs text-foreground tabular">{row.availabilityScore}%</span>
        </div>
      )
    },
    {
      key: 'lastUpdate',
      header: 'Last Sync',
      cell: (row) => <span className="text-xs text-muted-foreground">{row.lastUpdate}</span>
    }
  ]

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      {/* Status Select */}
      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
      >
        <option value="All">All Statuses</option>
        <option value="Verified">Verified</option>
        <option value="Pending">Pending</option>
        <option value="Suspended">Suspended</option>
      </select>

      {/* Country Select */}
      <select
        value={countryFilter}
        onChange={(e) => setCountryFilter(e.target.value)}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
      >
        {countries.map((c) => (
          <option key={c} value={c}>{c === 'All' ? 'All Locations' : c}</option>
        ))}
      </select>

      {/* Add Button */}
      <Button size="sm" onClick={() => setIsAddOpen(true)} className="bg-primary hover:bg-primary/95 text-white flex gap-1 items-center">
        <Plus className="size-3.5" />
        Add Pharmacy
      </Button>
    </div>
  )

  const rowActions = (row) => (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          setSelectedPharmacy(row)
          setIsDetailsOpen(true)
        }}
      >
        <Eye className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className={row.status === 'Suspended' ? 'text-success' : 'text-danger'}
        onClick={() => handleToggleSuspend(row.id)}
      >
        {row.status === 'Suspended' ? <CheckCircle2 className="size-4" /> : <Ban className="size-4" />}
      </Button>
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pharmacy Governance & Management"
        description="Verify licensing compliance, audit inventory streams, and toggle operational permissions."
      />

      {/* Bulk actions status panel */}
      {selectedIds.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm"
        >
          <span className="font-semibold text-primary">
            {selectedIds.size} pharmacies selected for bulk action
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleBulkApprove} className="bg-success text-white hover:bg-success/95">
              Approve All
            </Button>
            <Button size="sm" onClick={handleBulkReject} className="bg-danger text-white hover:bg-danger/95">
              Suspend All
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
          </div>
        </motion.div>
      )}

      {/* Main Table */}
      <Card className="border-border/70 bg-card">
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={filteredPharmacies}
            getRowId={(row) => row.id}
            searchable
            searchPlaceholder="Search by pharmacy name or license..."
            searchAccessor={(row) => `${row.name} ${row.license}`}
            toolbar={toolbar}
            rowActions={rowActions}
          />
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Pharmacy Record Details</DialogTitle>
            <DialogDescription>
              platform governance log for {selectedPharmacy?.name}
            </DialogDescription>
          </DialogHeader>
          {selectedPharmacy && (
            <div className="grid gap-4 py-4 text-sm">
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Verification status</span>
                <Badge variant={selectedPharmacy.status === 'Verified' ? 'default' : 'secondary'}>
                  {selectedPharmacy.status}
                </Badge>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">License Registration</span>
                <code>{selectedPharmacy.license}</code>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Headquarters Location</span>
                <span>{selectedPharmacy.city}, {selectedPharmacy.country}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Availability Engine Score</span>
                <span className="font-semibold">{selectedPharmacy.availabilityScore}%</span>
              </div>
              <div className="flex justify-between pb-1">
                <span className="text-muted-foreground">Last Database Sync</span>
                <span>{selectedPharmacy.lastUpdate}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDetailsOpen(false)}>
              Close
            </Button>
            {selectedPharmacy?.status !== 'Verified' && (
              <Button
                onClick={() => {
                  setPharmacies((prev) =>
                    prev.map((p) => (p.id === selectedPharmacy.id ? { ...p, status: 'Verified' } : p))
                  )
                  setIsDetailsOpen(false)
                }}
              >
                Approve Pharmacy
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Pharmacy Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Register New Pharmacy</DialogTitle>
            <DialogDescription>
              Enroll a pharmacy source under platform governance rules.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddPharmacy} className="flex flex-col gap-4 py-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Pharmacy Corporate Name</label>
              <Input
                value={newForm.name}
                onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
                placeholder="e.g. HealthBridge Pharmacy"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">License Number</label>
              <Input
                value={newForm.license}
                onChange={(e) => setNewForm({ ...newForm, license: e.target.value })}
                placeholder="e.g. LC-109283"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">City</label>
                <Input
                  value={newForm.city}
                  onChange={(e) => setNewForm({ ...newForm, city: e.target.value })}
                  placeholder="e.g. Chicago"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Country</label>
                <Input
                  value={newForm.country}
                  onChange={(e) => setNewForm({ ...newForm, country: e.target.value })}
                  placeholder="e.g. United States"
                  required
                />
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Submit Enrollment</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
