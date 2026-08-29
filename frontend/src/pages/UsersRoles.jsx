import { useState, useMemo, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DataTable } from '@/components/shared/data-table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  UserPlus,
  KeyRound,
  Ban,
  CheckCircle2,
  Trash2,
  Loader2,
  AlertTriangle,
  CreditCard,
  ShieldCheck,
} from 'lucide-react'
import * as admin from '@/services/admin-api'
import * as commercial from '@/services/commercial-api'
import { BILLING_CAPABILITIES } from '@/lib/commercial'
import { ROLE_OPTIONS, ROLE_LABELS, ROLE_BADGE, ROLES, isPharmacy } from '@/lib/roles'

export default function UsersRoles() {
  const [searchParams] = useSearchParams()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [roleFilter, setRoleFilter] = useState('All')
  const [busyId, setBusyId] = useState(null)

  const [selectedUser, setSelectedUser] = useState(null)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isResetOpen, setIsResetOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    role: ROLES.PHARMACY_STAFF,
    password: '',
  })
  const [resetPw, setResetPw] = useState('')
  const [formError, setFormError] = useState('')
  const [pharmacies, setPharmacies] = useState([])

  // Billing capability drawer state
  const [isCapOpen, setIsCapOpen] = useState(false)
  const [capUser, setCapUser] = useState(null)
  const [capData, setCapData] = useState(null)
  const [capError, setCapError] = useState('')
  const [capBusy, setCapBusy] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await admin.listUsers({ pageSize: 100 })
      setUsers(res.items)
    } catch (err) {
      setError(err.message || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  // Pharmacy-role accounts are locked out of the whole pharmacy portal until
  // they are linked to a pharmacy — /pharmacies/inventory and /dashboard answer
  // 403 without it — so the console needs to be able to make that link.
  const loadPharmacies = useCallback(async () => {
    try {
      const res = await admin.listPharmacies({ pageSize: 200 })
      setPharmacies(res?.items ?? [])
    } catch {
      setPharmacies([])
    }
  }, [])

  useEffect(() => {
    load()
    loadPharmacies()
  }, [load, loadPharmacies])

  const pharmacyNameById = useMemo(
    () => new Map(pharmacies.map((p) => [p.id, p.name])),
    [pharmacies],
  )

  const filteredUsers = useMemo(() => {
    if (roleFilter === 'All') return users
    return users.filter((u) => u.role === roleFilter)
  }, [users, roleFilter])

  const run = useCallback(
    async (id, action) => {
      setBusyId(id)
      setError('')
      try {
        await action()
        await load()
      } catch (err) {
        setError(err.message || 'Action failed')
      } finally {
        setBusyId(null)
      }
    },
    [load]
  )

  // UpdateUserDto treats an empty string as "clear the association" — it is
  // typed @IsString(), so '' is the documented signal rather than null.
  const assignPharmacy = (row, pharmacyId) =>
    run(row.id, async () => {
      await admin.updateUser(row.id, { pharmacyId: pharmacyId || '' })
      window.dispatchEvent(new CustomEvent('pharmacy-status-updated'))
    })

  // --- Billing capabilities (ZM-COM-BILL-001) -------------------------------

  const openCapabilities = async (row) => {
    setCapUser(row)
    setCapError('')
    setCapData(null)
    setIsCapOpen(true)
    try {
      setCapData(await commercial.getUserCapabilities(row.id))
    } catch (err) {
      setCapError(err.message || 'Could not load billing capabilities.')
    }
  }

  const refreshCapabilities = async () => {
    if (!capUser) return
    try {
      setCapData(await commercial.getUserCapabilities(capUser.id))
    } catch (err) {
      setCapError(err.message || 'Could not reload billing capabilities.')
    }
  }

  const toggleCapability = async (capability, held, financial) => {
    if (!capUser) return
    setCapBusy(capability)
    setCapError('')
    try {
      if (held) {
        const grant = capData?.grants?.find((g) => g.capability === capability)
        // A capability that comes from the role rather than a grant has no row to
        // revoke — say so instead of failing silently.
        if (!grant) {
          setCapError(
            `${capability} comes from the ${capUser.role} role, not a grant, so it cannot be revoked here.`,
          )
          return
        }
        await commercial.revokeCapability(grant.id)
      } else {
        await commercial.grantCapability({
          userId: capUser.id,
          capability,
          // Granting financial authority to an operational role is a
          // separation-of-duties trade-off the API refuses unless acknowledged.
          acknowledgeSeparationOfDutiesConflict: !!financial,
        })
      }
      await refreshCapabilities()
    } catch (err) {
      setCapError(err.message || 'Could not update the capability.')
    } finally {
      setCapBusy(null)
    }
  }

  const handleCreateUser = async (e) => {
    e.preventDefault()
    setFormError('')
    if (form.password.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }
    try {
      await admin.createUser(form)
      window.dispatchEvent(new CustomEvent('pharmacy-status-updated'))
      setIsAddOpen(false)
      setForm({ fullName: '', email: '', role: ROLES.PHARMACY_STAFF, password: '' })
      await load()
    } catch (err) {
      setFormError(err.message || 'Failed to create user')
    }
  }

  const handleResetPassword = async () => {
    if (resetPw.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }
    try {
      await admin.resetPassword(selectedUser.id, resetPw)
      setIsResetOpen(false)
      setResetPw('')
      setFormError('')
    } catch (err) {
      setFormError(err.message || 'Failed to reset password')
    }
  }

  const toggleStatus = (row) =>
    run(row.id, () => admin.setUserActive(row.id, !row.isActive))

  const changeRole = (row, role) =>
    run(row.id, async () => {
      await admin.setUserRole(row.id, role)
      window.dispatchEvent(new CustomEvent('pharmacy-status-updated'))
    })

  const confirmDelete = () =>
    run(deleteTarget.id, () => admin.deleteUser(deleteTarget.id)).then(() =>
      setDeleteTarget(null)
    )

  const columns = [
    {
      key: 'name',
      header: 'Full Name',
      sortable: true,
      accessor: (row) => row.fullName,
      cell: (row) => (
        <div className="flex items-center gap-2 font-medium text-foreground">
          <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
            {(row.fullName || '?').split(' ').map((n) => n[0]).join('').slice(0, 2)}
          </div>
          <span>{row.fullName}</span>
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Email Address',
      cell: (row) => <span className="text-muted-foreground">{row.email}</span>,
    },
    {
      key: 'role',
      header: 'Assigned Role',
      sortable: true,
      cell: (row) => (
        <Badge variant={ROLE_BADGE[row.role] || 'secondary'}>
          {ROLE_LABELS[row.role] || row.role}
        </Badge>
      ),
    },
    {
      key: 'pharmacy',
      header: 'Pharmacy',
      cell: (row) => {
        if (!isPharmacy(row.role)) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        if (!row.pharmacyId) {
          return (
            <Badge variant="warning" className="gap-1">
              <AlertTriangle className="size-3" />
              Not linked
            </Badge>
          )
        }
        return (
          <span className="text-xs text-foreground">
            {pharmacyNameById.get(row.pharmacyId) || row.pharmacyId}
          </span>
        )
      },
    },
    {
      key: 'isActive',
      header: 'Status',
      sortable: true,
      sortValue: (row) => (row.isActive ? 1 : 0),
      cell: (row) => (
        <Badge variant={row.isActive ? 'success' : 'destructive'}>
          {row.isActive ? 'Active' : 'Suspended'}
        </Badge>
      ),
    },
    {
      key: 'createdAt',
      header: 'Date Enrolled',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleDateString()}
        </span>
      ),
    },
  ]

  const toolbar = (
    <div className="flex items-center gap-3">
      <select
        value={roleFilter}
        onChange={(e) => setRoleFilter(e.target.value)}
        className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
      >
        <option value="All">All Roles</option>
        {ROLE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <Button
        size="sm"
        onClick={() => {
          setFormError('')
          setIsAddOpen(true)
        }}
        className="bg-primary hover:bg-primary/95 text-white flex gap-1 items-center"
      >
        <UserPlus className="size-3.5" />
        Create User
      </Button>
    </div>
  )

  const rowActions = (row) => (
    <div className="flex items-center justify-end gap-1">
      {busyId === row.id && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      <select
        value={row.role}
        title="Change role"
        disabled={busyId === row.id}
        onChange={(e) => changeRole(row, e.target.value)}
        className="rounded-md border border-border bg-card px-1.5 py-1 text-[11px] text-foreground outline-none focus:border-primary"
      >
        {ROLE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {isPharmacy(row.role) && (
        <select
          value={row.pharmacyId || ''}
          title="Assign pharmacy"
          disabled={busyId === row.id}
          onChange={(e) => assignPharmacy(row, e.target.value)}
          className="max-w-[9rem] rounded-md border border-border bg-card px-1.5 py-1 text-[11px] text-foreground outline-none focus:border-primary"
        >
          <option value="">Not linked</option>
          {pharmacies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {row.role !== ROLES.PUBLIC && (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Billing capabilities"
          onClick={() => openCapabilities(row)}
        >
          <CreditCard className="size-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        title="Reset Password"
        onClick={() => {
          setSelectedUser(row)
          setResetPw('')
          setFormError('')
          setIsResetOpen(true)
        }}
      >
        <KeyRound className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busyId === row.id}
        className={!row.isActive ? 'text-success' : 'text-danger'}
        onClick={() => toggleStatus(row)}
        title={row.isActive ? 'Suspend User' : 'Activate User'}
      >
        {row.isActive ? <Ban className="size-4" /> : <CheckCircle2 className="size-4" />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-danger"
        title="Delete User"
        onClick={() => setDeleteTarget(row)}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users & Roles"
        description="Provision platform credentials, assign access profiles, audit roles, and revoke permissions."
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      <Card className="border-border/70 bg-card">
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex items-center gap-2 py-16 justify-center text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading users…
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={filteredUsers}
              getRowId={(row) => row.id}
              searchable
              searchPlaceholder="Search by user name or email..."
              searchAccessor={(row) => `${row.fullName} ${row.email}`}
              // Arriving from the console search bar with a name already
              // typed there (MSA-31) — the same query, not re-typed here.
              initialQuery={searchParams.get('q') || ''}
              toolbar={toolbar}
              rowActions={rowActions}
            />
          )}
        </CardContent>
      </Card>

      {/* Add User Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Provision User Credentials</DialogTitle>
            <DialogDescription>
              Set up platform permissions for a corporate team member or external collaborator.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateUser} className="flex flex-col gap-4 py-2">
            {formError && (
              <div className="rounded-lg bg-danger/10 p-2.5 text-xs font-medium text-danger">
                {formError}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Full Name</label>
              <Input
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                placeholder="e.g. John Doe"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Email Address</label>
              <Input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                type="email"
                placeholder="e.g. j.doe@organization.org"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Temporary Password</label>
              <Input
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                type="text"
                placeholder="At least 8 characters"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Security Access Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Deploy Credentials</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Password Reset Dialog */}
      <Dialog open={isResetOpen} onOpenChange={setIsResetOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle className="flex gap-2 items-center text-primary">
              <KeyRound className="size-5" />
              Reset Access Credentials
            </DialogTitle>
            <DialogDescription>Set a new password for:</DialogDescription>
          </DialogHeader>
          <div className="bg-muted/40 border border-border/80 rounded-lg p-3 my-1 flex flex-col gap-1 text-center">
            <span className="font-semibold text-foreground">{selectedUser?.fullName}</span>
            <code className="text-xs text-muted-foreground">{selectedUser?.email}</code>
          </div>
          {formError && (
            <div className="rounded-lg bg-danger/10 p-2.5 text-xs font-medium text-danger">
              {formError}
            </div>
          )}
          <Input
            value={resetPw}
            onChange={(e) => setResetPw(e.target.value)}
            type="text"
            placeholder="New password (min 8 chars)"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResetOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleResetPassword}>Set Password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Delete user</DialogTitle>
            <DialogDescription>
              Permanently delete {deleteTarget?.fullName} ({deleteTarget?.email})? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Billing capabilities */}
      <Dialog open={isCapOpen} onOpenChange={setIsCapOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Billing capabilities</DialogTitle>
            <DialogDescription>
              {capUser?.fullName} ({capUser?.email}) — {ROLE_LABELS[capUser?.role] || capUser?.role}.
              Billing authority is separate from verification and inventory authority.
            </DialogDescription>
          </DialogHeader>

          {capUser?.role === ROLES.SUPER_ADMIN && (
            <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              <span className="text-foreground/90">
                A Super Admin holds every billing capability implicitly and is the only role that can
                delegate them. Nothing needs granting here.
              </span>
            </div>
          )}

          {capError && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {capError}
            </div>
          )}

          {!capData ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading capabilities…
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {BILLING_CAPABILITIES.map((cap) => {
                const held = capData.capabilities?.includes(cap.code)
                const fromGrant = capData.grants?.some((g) => g.capability === cap.code)
                const isSuper = capUser?.role === ROLES.SUPER_ADMIN
                return (
                  <div key={cap.code} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium text-foreground">{cap.label}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {isSuper
                          ? 'Held by role'
                          : held
                            ? fromGrant
                              ? 'Granted'
                              : 'From role'
                            : 'Not held'}
                        {cap.financial && ' · financial authority'}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant={held ? 'outline' : 'default'}
                      disabled={isSuper || capBusy === cap.code || (held && !fromGrant)}
                      onClick={() => toggleCapability(cap.code, held, cap.financial)}
                    >
                      {capBusy === cap.code && <Loader2 className="size-3.5 animate-spin" />}
                      {held ? 'Revoke' : 'Grant'}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCapOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
