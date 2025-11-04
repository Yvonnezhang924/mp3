// Load required packages
var User = require('../models/user');
var Task = require('../models/task');

module.exports = function (router) {
    
    // GET /users - Get list of users with query parameters
    router.route('/users')
        .get(function (req, res) {
            try {
                // Parse query parameters
                var where = req.query.where ? JSON.parse(req.query.where) : {};
                var sort = req.query.sort ? JSON.parse(req.query.sort) : {};
                var select = req.query.select ? JSON.parse(req.query.select) : {};
                var skip = req.query.skip ? parseInt(req.query.skip) : 0;
                var limit = req.query.limit ? parseInt(req.query.limit) : 0; // unlimited for users
                var count = req.query.count === 'true';

                // Execute query
                if (count) {
                    // Use countDocuments for better performance
                    User.countDocuments(where)
                        .then(function(countResult) {
                            res.status(200).json({
                                message: 'OK',
                                data: countResult
                            });
                        })
                        .catch(function(err) {
                            res.status(500).json({
                                message: 'Server error occurred while fetching users',
                                data: {}
                            });
                        });
                } else {
                    // Build query
                    var query = User.find(where);

                    // Apply select
                    if (Object.keys(select).length > 0) {
                        query = query.select(select);
                    }

                    // Apply sort
                    if (Object.keys(sort).length > 0) {
                        query = query.sort(sort);
                    }

                    // Apply skip
                    if (skip > 0) {
                        query = query.skip(skip);
                    }

                    // Apply limit (only if specified)
                    if (limit > 0) {
                        query = query.limit(limit);
                    }

                    query.then(function(users) {
                        res.status(200).json({
                            message: 'OK',
                            data: users
                        });
                    }).catch(function(err) {
                        res.status(500).json({
                            message: 'Server error occurred while fetching users',
                            data: {}
                        });
                    });
                }
            } catch (err) {
                res.status(400).json({
                    message: 'Invalid query parameters',
                    data: {}
                });
            }
        })
        // POST /users - Create new user
        .post(function (req, res) {
            // Validation: name and email are required
            if (!req.body.name || !req.body.email) {
                return res.status(400).json({
                    message: 'User name and email are required',
                    data: {}
                });
            }

            // Check if user with same email already exists
            User.findOne({ email: req.body.email })
                .then(function(existingUser) {
                    if (existingUser) {
                        return res.status(400).json({
                            message: 'User with this email already exists',
                            data: {}
                        });
                    }

                    // Create new user with defaults
                    var newUser = new User({
                        name: req.body.name,
                        email: req.body.email,
                        pendingTasks: req.body.pendingTasks || [],
                        dateCreated: req.body.dateCreated || Date.now()
                    });

                    return newUser.save();
                })
                .then(function(user) {
                    // Handle two-way reference: if pendingTasks are provided, update tasks
                    if (req.body.pendingTasks && req.body.pendingTasks.length > 0) {
                        var pendingTasks = req.body.pendingTasks;
                        var promises = pendingTasks.map(function(taskId) {
                            return Task.findById(taskId)
                                .then(function(task) {
                                    if (task && !task.completed) {
                                        task.assignedUser = user._id.toString();
                                        task.assignedUserName = user.name;
                                        return task.save();
                                    }
                                });
                        });
                        return Promise.all(promises).then(function() {
                            return user;
                        });
                    }
                    return user;
                })
                .then(function(user) {
                    res.status(201).json({
                        message: 'User created successfully',
                        data: user
                    });
                })
                .catch(function(err) {
                    if (err.name === 'ValidationError' || err.name === 'CastError') {
                        res.status(400).json({
                            message: 'Invalid user data provided',
                            data: {}
                        });
                    } else {
                        res.status(500).json({
                            message: 'Server error occurred while creating user',
                            data: {}
                        });
                    }
                });
        });

    // GET /users/:id - Get single user
    router.route('/users/:id')
        .get(function (req, res) {
            try {
                var select = req.query.select ? JSON.parse(req.query.select) : {};
                var query = User.findById(req.params.id);

                // Apply select if provided
                if (Object.keys(select).length > 0) {
                    query = query.select(select);
                }

                query.then(function(user) {
                    if (!user) {
                        return res.status(404).json({
                            message: 'User not found',
                            data: {}
                        });
                    }
                    res.status(200).json({
                        message: 'OK',
                        data: user
                    });
                }).catch(function(err) {
                    if (err.name === 'CastError') {
                        res.status(404).json({
                            message: 'User not found',
                            data: {}
                        });
                    } else {
                        res.status(500).json({
                            message: 'Server error occurred while fetching user',
                            data: {}
                        });
                    }
                });
            } catch (err) {
                res.status(400).json({
                    message: 'Invalid query parameters',
                    data: {}
                });
            }
        })
        // PUT /users/:id - Update entire user
        .put(function (req, res) {
            // Validation: name and email are required
            if (!req.body.name || !req.body.email) {
                return res.status(400).json({
                    message: 'User name and email are required',
                    data: {}
                });
            }

            User.findById(req.params.id)
                .then(function(user) {
                    if (!user) {
                        return res.status(404).json({
                            message: 'User not found',
                            data: {}
                        });
                    }

                    // Check if email is being changed and if new email already exists
                    if (req.body.email !== user.email) {
                        return User.findOne({ email: req.body.email })
                            .then(function(existingUser) {
                                if (existingUser) {
                                    return res.status(400).json({
                                        message: 'User with this email already exists',
                                        data: {}
                                    });
                                }
                                return null;
                            });
                    }
                    return null;
                })
                .then(function() {
                    // Get old pendingTasks before update
                    return User.findById(req.params.id)
                        .then(function(oldUser) {
                            var oldPendingTasks = oldUser ? oldUser.pendingTasks : [];
                            var newPendingTasks = req.body.pendingTasks || [];

                            // Remove old task assignments
                            var removeTasks = oldPendingTasks.filter(function(taskId) {
                                return newPendingTasks.indexOf(taskId) === -1;
                            });

                            // Add new task assignments
                            var addTasks = newPendingTasks.filter(function(taskId) {
                                return oldPendingTasks.indexOf(taskId) === -1;
                            });

                            // Unassign removed tasks
                            var unassignPromises = removeTasks.map(function(taskId) {
                                return Task.findById(taskId)
                                    .then(function(task) {
                                        if (task) {
                                            task.assignedUser = "";
                                            task.assignedUserName = "unassigned";
                                            return task.save();
                                        }
                                    });
                            });

                            // Assign new tasks
                            var assignPromises = addTasks.map(function(taskId) {
                                return Task.findById(taskId)
                                    .then(function(task) {
                                        if (task && !task.completed) {
                                            task.assignedUser = req.params.id;
                                            task.assignedUserName = req.body.name;
                                            return task.save();
                                        }
                                    });
                            });

                            return Promise.all([...unassignPromises, ...assignPromises])
                                .then(function() {
                                    // Update user
                                    return User.findByIdAndUpdate(
                                        req.params.id,
                                        {
                                            name: req.body.name,
                                            email: req.body.email,
                                            pendingTasks: newPendingTasks,
                                            dateCreated: req.body.dateCreated || oldUser.dateCreated
                                        },
                                        { new: true, runValidators: true }
                                    );
                                });
                        });
                })
                .then(function(user) {
                    if (!user) {
                        return res.status(404).json({
                            message: 'User not found',
                            data: {}
                        });
                    }
                    res.status(200).json({
                        message: 'User updated successfully',
                        data: user
                    });
                })
                .catch(function(err) {
                    if (err.name === 'CastError') {
                        res.status(404).json({
                            message: 'User not found',
                            data: {}
                        });
                    } else if (err.name === 'ValidationError') {
                        res.status(400).json({
                            message: 'Invalid user data provided',
                            data: {}
                        });
                    } else {
                        res.status(500).json({
                            message: 'Server error occurred while updating user',
                            data: {}
                        });
                    }
                });
        })
        // DELETE /users/:id - Delete user
        .delete(function (req, res) {
            User.findById(req.params.id)
                .then(function(user) {
                    if (!user) {
                        return res.status(404).json({
                            message: 'User not found',
                            data: {}
                        });
                    }

                    // Unassign all tasks assigned to this user (two-way reference)
                    var unassignPromises = user.pendingTasks.map(function(taskId) {
                        return Task.findById(taskId)
                            .then(function(task) {
                                if (task) {
                                    task.assignedUser = "";
                                    task.assignedUserName = "unassigned";
                                    return task.save();
                                }
                            });
                    });

                    return Promise.all(unassignPromises)
                        .then(function() {
                            return User.findByIdAndDelete(req.params.id);
                        });
                })
                .then(function(user) {
                    if (!user) {
                        return res.status(404).json({
                            message: 'User not found',
                            data: {}
                        });
                    }
                    res.status(204).send();
                })
                .catch(function(err) {
                    if (err.name === 'CastError') {
                        res.status(404).json({
                            message: 'User not found',
                            data: {}
                        });
                    } else {
                        res.status(500).json({
                            message: 'Server error occurred while deleting user',
                            data: {}
                        });
                    }
                });
        });

    return router;
};

