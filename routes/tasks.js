// Load required packages
var Task = require('../models/task');
var User = require('../models/user');

module.exports = function (router) {
    
    // GET /tasks - Get list of tasks with query parameters
    router.route('/tasks')
        .get(function (req, res) {
            try {
                // Parse query parameters
                var where = req.query.where ? JSON.parse(req.query.where) : {};
                var sort = req.query.sort ? JSON.parse(req.query.sort) : {};
                var select = req.query.select ? JSON.parse(req.query.select) : {};
                var skip = req.query.skip ? parseInt(req.query.skip) : 0;
                var limit = req.query.limit ? parseInt(req.query.limit) : 100; // default 100 for tasks
                var count = req.query.count === 'true';

                // Execute query
                if (count) {
                    // Use countDocuments for better performance
                    Task.countDocuments(where)
                        .then(function(countResult) {
                            res.status(200).json({
                                message: 'OK',
                                data: countResult
                            });
                        })
                        .catch(function(err) {
                            res.status(500).json({
                                message: 'Server error occurred while fetching tasks',
                                data: {}
                            });
                        });
                } else {
                    // Build query
                    var query = Task.find(where);

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

                    // Apply limit (default 100 for tasks)
                    query = query.limit(limit);

                    query.then(function(tasks) {
                        res.status(200).json({
                            message: 'OK',
                            data: tasks
                        });
                    }).catch(function(err) {
                        res.status(500).json({
                            message: 'Server error occurred while fetching tasks',
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
        // POST /tasks - Create new task
        .post(function (req, res) {
            // Validation: name and deadline are required
            if (!req.body.name || !req.body.deadline) {
                return res.status(400).json({
                    message: 'Task name and deadline are required',
                    data: {}
                });
            }

            // Create new task with defaults
            var newTask = new Task({
                name: req.body.name,
                description: req.body.description || "",
                deadline: req.body.deadline,
                completed: req.body.completed !== undefined ? req.body.completed : false,
                assignedUser: req.body.assignedUser || "",
                assignedUserName: req.body.assignedUserName || "unassigned",
                dateCreated: req.body.dateCreated || Date.now()
            });

            newTask.save()
                .then(function(task) {
                    // Handle two-way reference: if assignedUser is provided, update user's pendingTasks
                    if (task.assignedUser && task.assignedUser !== "" && !task.completed) {
                        return User.findById(task.assignedUser)
                            .then(function(user) {
                                if (user) {
                                    // Add task to user's pendingTasks if not already there
                                    var pendingTasks = user.pendingTasks || [];
                                    if (pendingTasks.indexOf(task._id.toString()) === -1) {
                                        pendingTasks.push(task._id.toString());
                                        user.pendingTasks = pendingTasks;
                                        return user.save();
                                    }
                                }
                            })
                            .then(function() {
                                return task;
                            });
                    }
                    return task;
                })
                .then(function(task) {
                    res.status(201).json({
                        message: 'Task created successfully',
                        data: task
                    });
                })
                .catch(function(err) {
                    if (err.name === 'ValidationError' || err.name === 'CastError') {
                        res.status(400).json({
                            message: 'Invalid task data provided',
                            data: {}
                        });
                    } else {
                        res.status(500).json({
                            message: 'Server error occurred while creating task',
                            data: {}
                        });
                    }
                });
        });

    // GET /tasks/:id - Get single task
    router.route('/tasks/:id')
        .get(function (req, res) {
            try {
                var select = req.query.select ? JSON.parse(req.query.select) : {};
                var query = Task.findById(req.params.id);

                // Apply select if provided
                if (Object.keys(select).length > 0) {
                    query = query.select(select);
                }

                query.then(function(task) {
                    if (!task) {
                        return res.status(404).json({
                            message: 'Task not found',
                            data: {}
                        });
                    }
                    res.status(200).json({
                        message: 'OK',
                        data: task
                    });
                }).catch(function(err) {
                    if (err.name === 'CastError') {
                        res.status(404).json({
                            message: 'Task not found',
                            data: {}
                        });
                    } else {
                        res.status(500).json({
                            message: 'Server error occurred while fetching task',
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
        // PUT /tasks/:id - Update entire task
        .put(function (req, res) {
            // Validation: name and deadline are required
            if (!req.body.name || !req.body.deadline) {
                return res.status(400).json({
                    message: 'Task name and deadline are required',
                    data: {}
                });
            }

            Task.findById(req.params.id)
                .then(function(task) {
                    if (!task) {
                        return res.status(404).json({
                            message: 'Task not found',
                            data: {}
                        });
                    }

                    // Store old values for two-way reference update
                    var oldAssignedUser = task.assignedUser || "";
                    var newAssignedUser = req.body.assignedUser || "";
                    var oldCompleted = task.completed;
                    var newCompleted = req.body.completed !== undefined ? req.body.completed : false;

                    // Update task
                    task.name = req.body.name;
                    task.description = req.body.description !== undefined ? req.body.description : task.description;
                    task.deadline = req.body.deadline;
                    task.completed = newCompleted;
                    task.assignedUser = newAssignedUser;
                    task.assignedUserName = req.body.assignedUserName || "unassigned";
                    task.dateCreated = req.body.dateCreated || task.dateCreated;

                    return task.save()
                        .then(function(updatedTask) {
                            // Handle two-way reference updates
                            var promises = [];

                            // If task was assigned to old user and is now unassigned or assigned to different user
                            if (oldAssignedUser && oldAssignedUser !== "" && (newAssignedUser === "" || oldAssignedUser !== newAssignedUser)) {
                                promises.push(
                                    User.findById(oldAssignedUser)
                                        .then(function(user) {
                                            if (user) {
                                                var pendingTasks = user.pendingTasks || [];
                                                var index = pendingTasks.indexOf(req.params.id);
                                                if (index !== -1) {
                                                    pendingTasks.splice(index, 1);
                                                    user.pendingTasks = pendingTasks;
                                                    return user.save();
                                                }
                                            }
                                        })
                                );
                            }

                            // If task is now assigned to a new user (and not completed)
                            if (newAssignedUser && newAssignedUser !== "" && oldAssignedUser !== newAssignedUser && !newCompleted) {
                                promises.push(
                                    User.findById(newAssignedUser)
                                        .then(function(user) {
                                            if (user) {
                                                var pendingTasks = user.pendingTasks || [];
                                                if (pendingTasks.indexOf(req.params.id) === -1) {
                                                    pendingTasks.push(req.params.id);
                                                    user.pendingTasks = pendingTasks;
                                                    return user.save();
                                                }
                                            }
                                        })
                                );
                            }

                            // If task became completed and was assigned, remove from pendingTasks
                            if (oldAssignedUser && oldAssignedUser !== "" && !oldCompleted && newCompleted) {
                                promises.push(
                                    User.findById(oldAssignedUser)
                                        .then(function(user) {
                                            if (user) {
                                                var pendingTasks = user.pendingTasks || [];
                                                var index = pendingTasks.indexOf(req.params.id);
                                                if (index !== -1) {
                                                    pendingTasks.splice(index, 1);
                                                    user.pendingTasks = pendingTasks;
                                                    return user.save();
                                                }
                                            }
                                        })
                                );
                            }

                            return Promise.all(promises).then(function() {
                                return updatedTask;
                            });
                        });
                })
                .then(function(task) {
                    res.status(200).json({
                        message: 'Task updated successfully',
                        data: task
                    });
                })
                .catch(function(err) {
                    if (err.name === 'CastError') {
                        res.status(404).json({
                            message: 'Task not found',
                            data: {}
                        });
                    } else if (err.name === 'ValidationError') {
                        res.status(400).json({
                            message: 'Invalid task data provided',
                            data: {}
                        });
                    } else {
                        res.status(500).json({
                            message: 'Server error occurred while updating task',
                            data: {}
                        });
                    }
                });
        })
        // DELETE /tasks/:id - Delete task
        .delete(function (req, res) {
            Task.findById(req.params.id)
                .then(function(task) {
                    if (!task) {
                        return res.status(404).json({
                            message: 'Task not found',
                            data: {}
                        });
                    }

                    var assignedUser = task.assignedUser;

                    // Remove task from user's pendingTasks (two-way reference)
                    if (assignedUser && assignedUser !== "") {
                        return User.findById(assignedUser)
                            .then(function(user) {
                                if (user) {
                                    var pendingTasks = user.pendingTasks || [];
                                    var index = pendingTasks.indexOf(req.params.id);
                                    if (index !== -1) {
                                        pendingTasks.splice(index, 1);
                                        user.pendingTasks = pendingTasks;
                                        return user.save();
                                    }
                                }
                            })
                            .then(function() {
                                return Task.findByIdAndDelete(req.params.id);
                            });
                    }

                    return Task.findByIdAndDelete(req.params.id);
                })
                .then(function(task) {
                    if (!task) {
                        return res.status(404).json({
                            message: 'Task not found',
                            data: {}
                        });
                    }
                    res.status(204).send();
                })
                .catch(function(err) {
                    if (err.name === 'CastError') {
                        res.status(404).json({
                            message: 'Task not found',
                            data: {}
                        });
                    } else {
                        res.status(500).json({
                            message: 'Server error occurred while deleting task',
                            data: {}
                        });
                    }
                });
        });

    return router;
};

