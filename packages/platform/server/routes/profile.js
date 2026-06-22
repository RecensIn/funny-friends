const { Router } = require('express');
const { ApiResponse, asyncHandler, requireAuth, requireCSRF, prisma } = require('./helpers');
const { validatePasswordStrength, hashPassword, comparePassword } = require('../middleware/security');
const router = Router();

// GET /api/user/profile
router.get('/api/user/profile', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, username: true, role: true, createdAt: true } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
}));

// PUT /api/user/profile
router.put('/api/user/profile', requireAuth, requireCSRF, asyncHandler(async (req, res) => {
  const { username } = req.body;
  if (!username || username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  const existingUser = await prisma.user.findUnique({ where: { username } });
  if (existingUser && existingUser.id !== req.user.id) return res.status(400).json({ error: 'Username already taken' });
  const updatedUser = await prisma.user.update({ where: { id: req.user.id }, data: { username }, select: { id: true, username: true, role: true, createdAt: true } });
  res.json({ success: true, user: updatedUser });
}));

// PUT /api/user/password
router.put('/api/user/password', requireAuth, requireCSRF, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const passwordCheck = validatePasswordStrength(newPassword);
  if (!passwordCheck.valid) return res.status(400).json({ error: 'Password does not meet security requirements', details: passwordCheck.errors });

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const isValidPassword = await comparePassword(currentPassword, user.password);
  if (!isValidPassword) return res.status(401).json({ error: 'Current password is incorrect' });

  const hashedPassword = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: req.user.id }, data: { password: hashedPassword, lastPasswordChange: new Date() } });

  await prisma.userSession.updateMany({ where: { userId: req.user.id, isValid: true, token: { not: req.user.sessionId } }, data: { isValid: false } });
  res.json({ success: true, message: 'Password updated successfully. Other sessions have been logged out for security.' });
}));

module.exports = router;