import { useState, useMemo, useEffect, useCallback } from 'react'
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
} from 'lucide-react'
import * as admin from '@/services/admin-api'
import { ROLE_OPTIONS, ROLE_LABELS, ROLE_BADGE, ROLES } from '@/lib/roles'

export default function UsersRoles() {
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

  useEffect(() => {
    load()
  }, [load])

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

  const handleCreateUser = async (e) => {
    e.preventDefault()
    setFormError('')
    if (form.password.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }
    try {
      await admin.createUser(form)
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
    run(row.id, () => admin.setUserRole(row.id, role))

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
    </div>
  )
}
