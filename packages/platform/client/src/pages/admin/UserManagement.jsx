import React, { useState, useEffect } from 'react';
import { Plus, Search, Filter, Edit2, Trash2, UserCheck, UserX, Shield, Gamepad2, CheckCircle, XCircle } from 'lucide-react';
import { API_URL } from '../../config';

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('ALL');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({
    username: '', password: '', role: 'PLAYER',
    isActive: true, allowedGames: {}
  });

  useEffect(() => { fetchUsers(); fetchGames(); }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_URL}/api/admin/users`, { credentials: 'include' });
      if (res.ok) setUsers(await res.json());
    } catch (e) { /* silent */ } finally { setLoading(false); }
  };

  const fetchGames = async () => {
    try {
      const res = await fetch(`${API_URL}/api/gametypes`, { credentials: 'include' });
      if (res.ok) setGames(await res.json());
    } catch (e) { /* silent */ }
  };

  const notify = (message, type) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const openCreate = () => {
    setEditingUser(null);
    setForm({ username: '', password: '', role: 'PLAYER', isActive: true, allowedGames: {} });
    setShowModal(true);
  };

  const openEdit = (user) => {
    setEditingUser(user);
    const perms = {};
    (user.allowedGames || []).forEach(p => { perms[p.gameTypeId] = { canCreate: p.canCreate, canManage: p.canManage }; });
    setForm({
      username: user.username, password: '',
      role: user.role, isActive: user.isActive !== false,
      allowedGames: perms
    });
    setShowModal(true);
  };

  const togglePermission = (gameId) => {
    setForm(prev => {
      const next = { ...prev.allowedGames };
      if (next[gameId]) {
        delete next[gameId];
      } else {
        next[gameId] = { canCreate: true, canManage: true };
      }
      return { ...prev, allowedGames: next };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.username.trim()) return notify('Username required', 'error');
    if (!editingUser && !form.password) return notify('Password required', 'error');

    const payload = {
      username: form.username.trim(), role: form.role, isActive: form.isActive,
      allowedGames: Object.entries(form.allowedGames).map(([gameTypeId, perms]) => ({
        gameTypeId, canCreate: perms.canCreate, canManage: perms.canManage
      }))
    };
    if (form.password) payload.password = form.password;

    try {
      const url = editingUser
        ? `${API_URL}/api/admin/users/${editingUser.id}`
        : `${API_URL}/api/admin/users`;
      const method = editingUser ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        notify(editingUser ? 'User updated' : 'User created', 'success');
        setShowModal(false);
        fetchUsers();
      } else {
        const err = await res.json();
        notify(err.error || 'Failed', 'error');
      }
    } catch (e) {
      notify('Network error', 'error');
    }
  };

  const handleDelete = async (userId) => {
    if (!window.confirm('Delete this user? This cannot be undone.')) return;
    try {
      const res = await fetch(`${API_URL}/api/admin/users/${userId}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) { notify('User deleted', 'success'); fetchUsers(); }
      else notify('Failed to delete', 'error');
    } catch (e) { notify('Network error', 'error'); }
  };

  const handleToggle = async (user) => {
    try {
      const res = await fetch(`${API_URL}/api/admin/users/${user.id}/toggle`, { method: 'POST', credentials: 'include' });
      if (res.ok) { notify(`User ${user.isActive ? 'deactivated' : 'activated'}`, 'success'); fetchUsers(); }
    } catch (e) { notify('Network error', 'error'); }
  };

  const filtered = users.filter(u => {
    const matchSearch = u.username.toLowerCase().includes(searchQuery.toLowerCase());
    const matchRole = filterRole === 'ALL' || u.role === filterRole;
    return matchSearch && matchRole;
  });

  const roleBadge = (role) => {
    const m = { ADMIN: 'bg-red-500/20 text-red-400', OPERATOR: 'bg-purple-500/20 text-purple-400', PLAYER: 'bg-blue-500/20 text-blue-400' };
    return m[role] || 'bg-slate-500/20 text-slate-400';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-50">User Management</h2>
          <p className="text-slate-400">Create, edit, and manage user accounts</p>
        </div>
        <button onClick={openCreate} className="btn btn-primary flex items-center gap-2">
          <Plus size={18} /> Create User
        </button>
      </div>

      <div className="card card-body flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text" placeholder="Search users..." value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="input pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={18} className="text-slate-400" />
          <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
            className="input w-auto">
            <option value="ALL">All Roles</option>
            <option value="ADMIN">Admin</option>
            <option value="OPERATOR">Operator</option>
            <option value="PLAYER">Player</option>
            <option value="GUEST">Guest</option>
          </select>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800 text-slate-400 text-xs uppercase">
              <tr>
                <th className="text-left py-3 px-4 font-medium">User</th>
                <th className="text-left py-3 px-4 font-medium">Role</th>
                <th className="text-left py-3 px-4 font-medium">Status</th>
                <th className="text-left py-3 px-4 font-medium">Games</th>
                <th className="text-right py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {loading ? (
                <tr><td colSpan="5" className="py-12 text-center text-slate-500">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan="5" className="py-12 text-center text-slate-500">No users found</td></tr>
              ) : (
                filtered.map(user => (
                  <tr key={user.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-violet-700 rounded-full flex items-center justify-center text-white font-bold text-xs">
                          {user.username[0].toUpperCase()}
                        </div>
                        <span className="font-medium text-slate-100">{user.username}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${roleBadge(user.role)}`}>
                        {user.role === 'ADMIN' && <Shield size={12} />}
                        {user.role}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <button onClick={() => handleToggle(user)} className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                        user.isActive ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      }`}>
                        {user.isActive ? <UserCheck size={12} /> : <UserX size={12} />}
                        {user.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      <span className="flex items-center gap-1"><Gamepad2 size={14} />{user.allowedGames?.length || 0}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(user)} className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-violet-400 transition-colors" title="Edit">
                          <Edit2 size={16} />
                        </button>
                        <button onClick={() => handleDelete(user.id)} className="p-1.5 hover:bg-red-500/20 rounded-lg text-slate-400 hover:text-red-400 transition-colors" title="Delete">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="card-header">
              <h3 className="text-lg font-bold text-slate-50">{editingUser ? 'Edit User' : 'Create New User'}</h3>
            </div>

            <form onSubmit={handleSubmit} className="card-body space-y-4">
              <div className="form-group">
                <label className="form-label">Username</label>
                <input type="text" required value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })}
                  className="input" placeholder="Enter username" />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Password {editingUser && '(leave blank to keep current)'}
                </label>
                <input type="password" required={!editingUser}
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  className="input" placeholder={editingUser ? '••••••••' : 'Enter password'} />
              </div>

              <div className="form-group">
                <label className="form-label">Role</label>
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="input">
                  <option value="PLAYER">Player</option>
                  <option value="OPERATOR">Operator</option>
                  <option value="ADMIN">Admin</option>
                  <option value="GUEST">Guest</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Game Permissions</label>
                <div className="grid grid-cols-2 gap-2">
                  {games.map(game => {
                    const selected = !!form.allowedGames[game.id];
                    return (
                      <button key={game.id} type="button" onClick={() => togglePermission(game.id)}
                        className={`p-3 rounded-lg border-2 text-left transition-all ${selected ? 'border-violet-500 bg-violet-500/10' : 'border-slate-600 hover:border-slate-500'}`}>
                        <div className="flex items-center gap-2">
                          <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${selected ? 'bg-violet-500 border-violet-500 text-white' : 'border-slate-500'}`}>
                            {selected ? '✓' : ''}
                          </span>
                          <span className="text-sm text-slate-200">{game.name}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input type="checkbox" id="user-isActive" checked={form.isActive}
                  onChange={e => setForm({ ...form, isActive: e.target.checked })}
                  className="w-4 h-4 rounded accent-violet-600" />
                <label htmlFor="user-isActive" className="text-sm text-slate-300">Account Active</label>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-700">
                <button type="button" onClick={() => setShowModal(false)}
                  className="btn btn-outline flex-1">Cancel</button>
                <button type="submit" className="btn btn-primary flex-1">
                  {editingUser ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;