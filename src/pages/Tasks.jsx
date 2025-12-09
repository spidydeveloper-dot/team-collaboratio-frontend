import { useState, useEffect } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { taskAPI, projectAPI, teamAPI } from "@/services/api";
import { TASK_STATUS, STATUS_LABELS, STATUS_COLORS, ROLES } from "@/utils/constants";
import { useAuth } from "@/context/AuthContext";
import Button from "@/components/Button";
import Card, { CardHeader, CardTitle, CardContent } from "@/components/Card";
import Badge from "@/components/Badge";
import Modal from "@/components/Modal";
import Input from "@/components/Input";
import Select from "@/components/Select";
import Avatar from "@/components/Avatar";
import { Plus, Trash2, User } from "lucide-react";
import toast from "react-hot-toast";

export default function Tasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    projectId: "",
    status: TASK_STATUS.TODO,
    assignedTo: "",
  });

  useEffect(() => {
    fetchProjects();
    // Preload members list for managers to ensure dropdown has users even before selecting a project
    if (user?.role === ROLES.MANAGER) {
      fetchAllMembers();
    }
  }, [user?.role]);

  useEffect(() => {
    if (selectedProject) {
      fetchTasks();
      // Refresh team members for the selected project (manager view)
      if (user?.role === ROLES.MANAGER) {
        fetchProjectMembers(selectedProject);
      }
    } else if (projects.length === 0) {
      // If no projects, set loading to false
      setLoading(false);
    }
  }, [selectedProject, projects.length, user?.role]);

  const fetchAllMembers = async () => {
    try {
      const response = await teamAPI.getAllMembers();
      const membersOnly = (response.data.members || []).filter(
        (member) => member.role === ROLES.MEMBER
      );
      setTeamMembers(membersOnly);
    } catch (error) {
      console.error("Failed to fetch members:", error);
    }
  };

  const fetchProjectMembers = async (projectId) => {
    if (!projectId) return;
    const project = projects.find((p) => p._id === projectId);
    if (!project) return;

    const teamId =
      typeof project.teamId === "object"
        ? project.teamId._id || project.teamId.id
        : project.teamId;

    try {
      // Prefer project-specific team members; fallback to all members if empty
      const response = await teamAPI.getMembers(teamId);
      let membersOnly = (response.data.members || []).filter(
        (member) => member.role === ROLES.MEMBER
      );
      if (membersOnly.length === 0) {
        await fetchAllMembers();
        return;
      }
      setTeamMembers(membersOnly);
    } catch (error) {
      console.error("Failed to fetch project members:", error);
      await fetchAllMembers();
    }
  };

  const fetchProjects = async () => {
    try {
      const response = await projectAPI.getAll(user?.teamId || undefined);
      setProjects(response.data?.projects || []);
      if (response.data?.projects?.length > 0) {
        setSelectedProject(response.data.projects[0]._id);
      }
      setLoading(false);
    } catch (error) {
      toast.error("Failed to fetch projects");
      setLoading(false);
    }
  };

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const response = await taskAPI.getAll(selectedProject);
      let fetchedTasks = response.data?.tasks || [];
      
      // Filter tasks based on role:
      // - MEMBER: Only see tasks assigned to them
      // - MANAGER/ADMIN: See all tasks
      if (user?.role === ROLES.MEMBER) {
        fetchedTasks = fetchedTasks.filter((task) => {
          // Members only see tasks assigned to them (not unassigned tasks)
          if (!task.assignedTo) return false;
          const assignedToId = typeof task.assignedTo === "object" 
            ? (task.assignedTo.id || task.assignedTo._id)
            : task.assignedTo;
          return assignedToId === (user.id || user._id);
        });
      }
      
      setTasks(fetchedTasks);
    } catch (error) {
      toast.error("Failed to fetch tasks");
    } finally {
      setLoading(false);
    }
  };

  const handleDragEnd = async (result) => {
    if (!result.destination) return;

    const { draggableId, destination } = result;
    const newStatus = destination.droppableId;

    try {
      await taskAPI.update(draggableId, { status: newStatus });
      setTasks(
        tasks.map((task) =>
          task._id === draggableId ? { ...task, status: newStatus } : task
        )
      );
      toast.success("Task updated successfully");
    } catch (error) {
      toast.error("Failed to update task");
    }
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    try {
      const taskData = {
        ...newTask,
        projectId: selectedProject,
      };
      // Only include assignedTo if it's set and user is a manager
      if (!taskData.assignedTo || user?.role !== ROLES.MANAGER) {
        delete taskData.assignedTo;
      }
      const response = await taskAPI.create(taskData);
      const newTaskData = response.data.task;
      
      // Only add to tasks if user should see it (member sees only assigned, manager/admin sees all)
      if (user?.role === ROLES.MEMBER) {
        const assignedToId = typeof newTaskData.assignedTo === "object" 
          ? (newTaskData.assignedTo.id || newTaskData.assignedTo._id)
          : newTaskData.assignedTo;
        // Members only see tasks assigned to them (not unassigned)
        if (assignedToId === (user.id || user._id)) {
          setTasks([...tasks, newTaskData]);
        }
      } else {
        setTasks([...tasks, newTaskData]);
      }
      
      setIsModalOpen(false);
      setNewTask({
        title: "",
        description: "",
        projectId: "",
        status: TASK_STATUS.TODO,
        assignedTo: "",
      });
      toast.success("Task created successfully");
    } catch (error) {
      toast.error(error.message || "Failed to create task");
    }
  };

  const handleUpdateAssignee = async (taskId, assignedTo) => {
    if (user?.role !== ROLES.MANAGER) {
      toast.error("Only Managers can assign tasks");
      return;
    }
    
    try {
      const taskData = { assignedTo: assignedTo || null };
      const response = await taskAPI.update(taskId, taskData);
      const updatedTask = response.data.task;
      
      // Update tasks list - if member, remove task if no longer assigned to them
      if (user?.role === ROLES.MEMBER) {
        const assignedToId = assignedTo 
          ? (typeof updatedTask.assignedTo === "object" 
              ? (updatedTask.assignedTo.id || updatedTask.assignedTo._id)
              : updatedTask.assignedTo)
          : null;
        // Members only see tasks assigned to them (not unassigned)
        if (assignedToId === (user.id || user._id)) {
          setTasks(
            tasks.map((task) =>
              task._id === taskId ? updatedTask : task
            )
          );
        } else {
          // Remove task if no longer assigned to this member
          setTasks(tasks.filter((task) => task._id !== taskId));
        }
      } else {
        // Manager/Admin sees all tasks
        setTasks(
          tasks.map((task) =>
            task._id === taskId ? updatedTask : task
          )
        );
      }
      
      toast.success(`Task ${assignedTo ? "assigned" : "unassigned"} successfully`);
    } catch (error) {
      toast.error(error.message || "Failed to update assignee");
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!confirm("Are you sure you want to delete this task?")) return;

    try {
      await taskAPI.delete(taskId);
      setTasks(tasks.filter((task) => task._id !== taskId));
      toast.success("Task deleted successfully");
    } catch (error) {
      toast.error("Failed to delete task");
    }
  };

  const getTasksByStatus = (status) => {
    return tasks.filter((task) => task.status === status);
  };

  const selectedProjectObj = projects.find((p) => p._id === selectedProject);
  const projectOptions = projects.map((p) => ({ value: p._id, label: p.name }));
  const statusOptions = Object.entries(STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
  }));
  const memberOptions = [
    { value: "", label: "Unassigned" },
    ...teamMembers.map((m) => ({
      value: m.id || m._id,
      label: `${m.name}${m.email ? ` (${m.email})` : ""}`,
    })),
  ];

  // Only MANAGER can assign tasks (not ADMIN)
  const canAssignTasks = user?.role === ROLES.MANAGER;
  const canDeleteTasks = user?.role === ROLES.ADMIN;
  // Only ADMIN and MANAGER can create tasks (MEMBERS cannot)
  const canCreateTasks = user?.role === ROLES.ADMIN || user?.role === ROLES.MANAGER;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            Tasks
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Manage your tasks with Kanban board
          </p>
          {user?.role === "MANAGER" && (
            <p className="text-sm text-blue-600 dark:text-blue-400 mt-2">
              ℹ️ As a Manager, you can assign tasks to team members. Only assigned users will see their tasks.
            </p>
          )}
          {user?.role === "ADMIN" && (
            <p className="text-sm text-purple-600 dark:text-purple-400 mt-2">
              ℹ️ As an Admin, you can delete tasks and see all tasks, but cannot assign them (only Managers can assign)
            </p>
          )}
          {user?.role === "MEMBER" && (
            <p className="text-sm text-green-600 dark:text-green-400 mt-2">
              ℹ️ As a Member, you can only see tasks assigned to you and update their status. You cannot create tasks.
            </p>
          )}
        </div>
        <div className="flex gap-4">
          {projects.length > 0 && (
            <Select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              options={projectOptions}
              className="w-48"
            />
          )}
          {canCreateTasks && (
            <Button onClick={() => setIsModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Task
            </Button>
          )}
        </div>
      </div>

      {canAssignTasks && selectedProjectObj && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Team members for this project</CardTitle>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  You can assign tasks only to members of the project's team.
                </p>
              </div>
              <Badge variant="secondary">{teamMembers.length} members</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {teamMembers.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No members found for this project&apos;s team.
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {teamMembers.map((member) => (
                  <div
                    key={member._id || member.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-md bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700"
                  >
                    <Avatar name={member.name} size="sm" />
                    <div>
                      <p className="text-sm text-gray-900 dark:text-gray-100">
                        {member.name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {member.email}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Object.entries(STATUS_LABELS).map(([status, label]) => (
            <div key={status} className="space-y-4">
              <div className="flex items-center gap-2">
                <div
                  className={`w-3 h-3 rounded-full ${STATUS_COLORS[status]}`}
                />
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                  {label}
                </h3>
                <Badge variant="default">
                  {getTasksByStatus(status).length}
                </Badge>
              </div>

              <Droppable droppableId={status}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`space-y-3 min-h-[500px] p-4 rounded-lg transition-colors ${
                      snapshot.isDraggingOver
                        ? "bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-300 dark:border-blue-700"
                        : "bg-gray-50 dark:bg-gray-800/50 border-2 border-gray-200 dark:border-gray-700"
                    }`}
                  >
                    {getTasksByStatus(status).map((task, index) => (
                      <Draggable
                        key={task._id}
                        draggableId={task._id}
                        index={index}
                      >
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                          >
                            <Card
                              className={`cursor-move ${
                                snapshot.isDragging
                                  ? "shadow-2xl rotate-2"
                                  : "hover:shadow-md"
                              } transition-all`}
                            >
                              <CardHeader>
                                <div className="flex items-start justify-between gap-2">
                                  <CardTitle className="text-base">
                                    {task.title}
                                  </CardTitle>
                                  {canDeleteTasks && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex-shrink-0"
                                      onClick={() => handleDeleteTask(task._id)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </CardHeader>
                              <CardContent className="pt-0 space-y-2">
                                {task.description && (
                                  <p className="text-sm text-gray-600 dark:text-gray-400">
                                    {task.description}
                                  </p>
                                )}
                                <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                                  <div className="flex items-center gap-2">
                                    {task.assignedTo ? (
                                      typeof task.assignedTo === "object" ? (
                                        <div className="flex items-center gap-2">
                                          <Avatar
                                            name={task.assignedTo.name}
                                            size="sm"
                                          />
                                          <span className="text-xs text-gray-600 dark:text-gray-400">
                                            {task.assignedTo.name}
                                          </span>
                                        </div>
                                      ) : (
                                        <div className="flex items-center gap-2">
                                          <User className="h-4 w-4 text-gray-400" />
                                          <span className="text-xs text-gray-600 dark:text-gray-400">
                                            Assigned
                                          </span>
                                        </div>
                                      )
                                    ) : (
                                      <span className="text-xs text-gray-400">
                                        Unassigned
                                      </span>
                                    )}
                                  </div>
                                  {canAssignTasks && (
                                    <Select
                                      value={
                                        typeof task.assignedTo === "object"
                                          ? task.assignedTo.id || task.assignedTo._id
                                          : task.assignedTo || ""
                                      }
                                      onChange={(e) =>
                                        handleUpdateAssignee(task._id, e.target.value)
                                      }
                                      options={memberOptions}
                                      className="text-xs w-32"
                                    />
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
        </div>
      </DragDropContext>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create New Task"
      >
        <form onSubmit={handleCreateTask} className="space-y-4">
          <Input
            label="Title"
            value={newTask.title}
            onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
            placeholder="Enter task title"
            required
          />
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
              Description
            </label>
            <textarea
              value={newTask.description}
              onChange={(e) =>
                setNewTask({ ...newTask, description: e.target.value })
              }
              placeholder="Enter task description"
              rows={3}
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 
                bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                focus:ring-2 focus:ring-blue-500 focus:border-transparent
                placeholder-gray-400 dark:placeholder-gray-500"
            />
          </div>
          <Select
            label="Status"
            value={newTask.status}
            onChange={(e) => setNewTask({ ...newTask, status: e.target.value })}
            options={statusOptions}
          />
          {canAssignTasks && (
            <Select
              label="Assign To"
              value={newTask.assignedTo}
              onChange={(e) =>
                setNewTask({ ...newTask, assignedTo: e.target.value })
              }
              options={memberOptions}
            />
          )}
          <Button type="submit" className="w-full">
            Create Task
          </Button>
        </form>
      </Modal>
    </div>
  );
}
