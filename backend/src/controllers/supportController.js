const SupportTicket = require('../models/SupportTicket');
const { Notification } = require('../models/index');
const User = require('../models/User');

// POST /api/support/tickets  (student or teacher)
const createTicket = async (req, res) => {
  try {
    const { subject, category, message } = req.body;
    if (!subject || !subject.trim()) {
      return res.status(400).json({ success: false, message: 'Please add a subject for your ticket.' });
    }
    if ((!message || !message.trim()) && !req.file) {
      return res.status(400).json({ success: false, message: 'Please describe the issue, or attach a screenshot.' });
    }

    const firstMessage = {
      sender: req.user._id,
      senderName: req.user.name,
      senderRole: req.user.role,
      message: (message || '').trim(),
      attachmentUrl: req.file ? `/uploads/support/${req.file.filename}` : null,
    };

    const ticket = await SupportTicket.create({
      user: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      subject: subject.trim(),
      category: category || 'other',
      messages: [firstMessage],
      lastMessageAt: new Date(),
    });

    // Notify all admins of the new ticket
    const admins = await User.find({ role: 'admin' }).select('_id');
    await Promise.all(admins.map(admin => Notification.create({
      recipient: admin._id,
      title: 'New Help & Support ticket',
      message: `${req.user.name} (${req.user.role}) raised: "${subject.trim()}"`,
      type: 'support',
      link: `/admin/support/${ticket._id}`,
      relatedId: ticket._id,
    })));

    res.status(201).json({ success: true, ticket });
  } catch (error) {
    console.error('Create support ticket error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/support/tickets  (student or teacher - their own tickets)
const getMyTickets = async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ user: req.user._id })
      .sort({ lastMessageAt: -1 })
      .select('-messages'); // list view doesn't need full thread

    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/support/tickets/:id  (owner, or admin)
const getTicket = async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    const isOwner = ticket.user.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to view this ticket.' });
    }

    res.json({ success: true, ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// POST /api/support/tickets/:id/reply  (owner, or admin)
const replyToTicket = async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    const isOwner = ticket.user.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not authorized to reply to this ticket.' });
    }

    const { message } = req.body;
    if ((!message || !message.trim()) && !req.file) {
      return res.status(400).json({ success: false, message: 'Write a message, or attach a screenshot.' });
    }

    ticket.messages.push({
      sender: req.user._id,
      senderName: req.user.name,
      senderRole: req.user.role,
      message: (message || '').trim(),
      attachmentUrl: req.file ? `/uploads/support/${req.file.filename}` : null,
    });
    ticket.lastMessageAt = new Date();

    if (isAdmin) {
      if (!ticket.firstRespondedAt) ticket.firstRespondedAt = new Date();
      if (ticket.status === 'open') ticket.status = 'in-progress';

      await Notification.create({
        recipient: ticket.user,
        title: 'Support team replied',
        message: `Your ticket "${ticket.subject}" got a new reply.`,
        type: 'support',
        link: '/help-support',
        relatedId: ticket._id,
      });
    } else {
      // Ticket owner followed up - re-open a resolved ticket, and ping admins
      if (ticket.status === 'resolved') ticket.status = 'in-progress';
      const admins = await User.find({ role: 'admin' }).select('_id');
      await Promise.all(admins.map(admin => Notification.create({
        recipient: admin._id,
        title: 'New reply on a support ticket',
        message: `${req.user.name} replied on: "${ticket.subject}"`,
        type: 'support',
        link: `/admin/support/${ticket._id}`,
        relatedId: ticket._id,
      })));
    }

    await ticket.save();
    res.json({ success: true, ticket });
  } catch (error) {
    console.error('Reply to support ticket error:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// GET /api/admin/support/tickets  (admin - all tickets)
const getAllTicketsAdmin = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;

    const tickets = await SupportTicket.find(filter)
      .sort({ lastMessageAt: -1 })
      .select('-messages');

    res.json({ success: true, tickets });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// PATCH /api/admin/support/tickets/:id/status  (admin)
const updateTicketStatusAdmin = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['open', 'in-progress', 'resolved'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }
    const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    res.json({ success: true, ticket });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = {
  createTicket,
  getMyTickets,
  getTicket,
  replyToTicket,
  getAllTicketsAdmin,
  updateTicketStatusAdmin,
};
