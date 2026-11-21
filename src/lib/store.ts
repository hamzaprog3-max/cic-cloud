// Unified Auth + Live Cloudflare D1 Database & Cloudflare R2 Storage client
import fallbackData from "@/data/fallback-data.json";
import { getWorkerApiBase, uploadFileToR2 } from "@/lib/r2";

export const fallbackDepartments: Department[] = (fallbackData.departments || []) as Department[];
export const fallbackCategories: MaterialCategory[] = (fallbackData.categories || []) as MaterialCategory[];
export const fallbackCourses: Course[] = (fallbackData.courses || []) as Course[];
export const fallbackMaterials: Material[] = (fallbackData.materials || []) as Material[];

// Clean up any legacy offline-hack localStorage keys from previous broken builds
if (typeof localStorage !== "undefined") {
  const legacyKeys = [
    "lms_added_materials",
    "lms_updated_materials",
    "lms_deleted_materials",
    "lms_archived_materials",
    "lms_added_courses",
    "lms_updated_courses",
    "lms_deleted_courses",
    "lms_added_links",
    "lms_deleted_links",
    "lms_emergency_auth",
  ];
  for (const k of legacyKeys) {
    try {
      localStorage.removeItem(k);
    } catch {}
  }
}

const API_BASE = () => getWorkerApiBase();

function getAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("lms_token") : null;
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE()}${path}`, {
    method: "GET",
    headers: getAuthHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

async function apiMutate<T = unknown>(
  path: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown
): Promise<T> {
  const res = await fetch(`${API_BASE()}${path}`, {
    method,
    headers: getAuthHeaders(body !== undefined ? { "Content-Type": "application/json" } : undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `فشل تنفيذ العملية (${res.status})`);
  }
  return data as T;
}

export type Permission =
  | "edit_content"
  | "add_courses"
  | "strict_add_only"
  | "add_pdf_existing"
  | "announcements"
  | "add_external_resources"
  | "manage_categories"
  | "edit_materials"
  | "delete_materials";

export const PERMISSION_LABELS: Record<Permission, string> = {
  edit_content: "التعديل",
  add_courses: "إضافة مواد",
  strict_add_only: "إضافة وعدم حذف أو تعديل",
  add_pdf_existing: "إضافة PDF في مقرر موجود",
  announcements: "إعلان وإشعار",
  add_external_resources: "إضافة مصادر خارجية",
  manage_categories: "إدارة الأقسام الداخلية",
  edit_materials: "تعديل بيانات الملفات المرفوعة (الاسم، الرابط، إلخ)",
  delete_materials: "حذف المواد والمقررات",
};

export interface Department {
  id: string;
  name_ar: string;
  name_en: string;
  created_at?: string;
}

export interface MaterialCategory {
  id: string;
  name_ar: string;
  name_en: string;
  /** null = unified category shown in every department */
  department_id?: string | null;
  /** null = unified category shown in every academic year */
  academic_year?: string | null;
  display_order?: number | null;
  created_at?: string;
}

export interface Course {
  id: string;
  name: string;
  code: string;
  description: string;
  description_ar?: string;
  color: string;
  department_id?: string | null;
  academic_year: string;
  semester: string;
  notes?: string | null;
  created_at?: string;
}

export interface Material {
  id: string;
  title: string;
  type: "lecture" | "section" | "resource";
  course_id: string;
  category_id?: string | null;
  pdf_url?: string | null;
  pdf_display_name?: string | null;
  external_link?: string | null;
  submission_link?: string | null;
  deadline?: string | null;
  is_assignment: boolean;
  is_list?: boolean;
  list_content?: string | null;
  is_reference?: boolean | null;
  section_number?: string | null;
  notes?: string | null;
  archived: boolean;
  sort_order?: number | null;
  video_url?: string | null;
  deleted_at?: string | null;
  created_at: string;
}

export interface ImportantLink {
  id: string;
  title: string;
  title_ar?: string | null;
  url: string;
  is_persistent: boolean;
  department_id?: string | null;
  created_at?: string;
}

export interface Moderator {
  id: string;
  username: string;
  password: string;
  display_name: string;
  permissions: Permission[];
  department_id?: string | null;
  academic_year: string;
  created_at: string;
}

export interface ModeratorCourseAccess {
  id: string;
  moderator_id: string;
  course_id: string;
  created_at: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  target_audience: string;
  target_year?: string | null;
  link?: string | null;
  sent_by: string;
  created_at: string;
}

export interface NotificationTemplate {
  id: string;
  title_template: string;
  message_template: string;
  created_at?: string;
  updated_at?: string;
}

export interface Announcement {
  id: string;
  content: string;
  expires_at: string;
  link?: string | null;
  target_year?: string | null;
  target_dept?: string | null;
  created_by?: string;
  created_at?: string;
  color?: string | null;
}

export type UserRole = "owner" | "moderator" | null;

export interface CurrentUser {
  role: UserRole;
  moderatorId?: string;
  permissions?: Permission[];
  displayName?: string;
  departmentId?: string | null;
  academicYear?: string;
}

const COURSE_COLORS = [
  "190 80% 45%", "260 70% 55%", "340 70% 55%", "30 80% 50%",
  "150 60% 45%", "210 70% 50%", "0 70% 55%", "280 60% 50%",
];

function normalizeDeptId(departmentId: string): string {
  if (departmentId === "cs-dept-id") return "9eaab1c7-37e2-44a4-afbe-738586d50835";
  if (departmentId === "ai-cyber-dept-id") return "ca4069a4-fc50-4e96-8fb7-c1f4ea67da4f";
  return departmentId;
}

// ============ AUTH ============
export const auth = {
  getCurrentUser: (): CurrentUser => {
    const role = localStorage.getItem("lms_role") as UserRole;
    if (role === "owner") return { role: "owner", displayName: "المالك" };
    if (role === "moderator") {
      const modId = localStorage.getItem("lms_mod_id") || "";
      const permsStr = localStorage.getItem("lms_mod_perms") || "[]";
      const displayName = localStorage.getItem("lms_mod_name") || "مشرف";
      const departmentId = localStorage.getItem("lms_mod_dept") || null;
      const academicYear = localStorage.getItem("lms_mod_year") || "1";
      try {
        const permissions = JSON.parse(permsStr) as Permission[];
        return { role: "moderator", moderatorId: modId, permissions, displayName, departmentId, academicYear };
      } catch {
        return { role: "moderator", moderatorId: modId, permissions: [], displayName, departmentId, academicYear };
      }
    }
    return { role: null };
  },
  isLoggedIn: (): boolean => {
    const role = localStorage.getItem("lms_role");
    const token = localStorage.getItem("lms_token");
    return (role === "owner" || role === "moderator") && Boolean(token);
  },
  hasValidSession: async (): Promise<boolean> => {
    const token = localStorage.getItem("lms_token");
    if (!token) return false;
    try {
      const res = await fetch(`${API_BASE()}/api/auth/verify`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) return true;
      if (res.status === 401 || res.status === 403) return false;
      // Network/5xx transient error — don't kick user out
      return true;
    } catch {
      return Boolean(token);
    }
  },
  isOwner: (): boolean => localStorage.getItem("lms_role") === "owner",

  hasPermission: (perm: Permission): boolean => {
    const user = auth.getCurrentUser();
    if (user.role === "owner") return true;
    if (user.role === "moderator") return user.permissions?.includes(perm) || false;
    return false;
  },
  login: async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(`${API_BASE()}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await response.json().catch(() => null);

      if (response.ok && data?.role && data?.token) {
        localStorage.setItem("lms_token", data.token);
        localStorage.setItem("lms_role", data.role);
        if (data.role === "moderator") {
          localStorage.setItem("lms_mod_id", data.moderatorId || "");
          localStorage.setItem("lms_mod_perms", JSON.stringify(data.permissions || []));
          localStorage.setItem("lms_mod_name", data.displayName || "مشرف");
          localStorage.setItem("lms_mod_dept", data.departmentId || "");
          localStorage.setItem("lms_mod_year", data.academicYear || "1");
        } else {
          localStorage.removeItem("lms_mod_id");
          localStorage.removeItem("lms_mod_perms");
          localStorage.removeItem("lms_mod_name");
          localStorage.removeItem("lms_mod_dept");
          localStorage.removeItem("lms_mod_year");
        }
        return { success: true };
      }

      return { success: false, error: data?.error || "اسم المستخدم أو كلمة المرور غير صحيحة" };
    } catch (err) {
      console.error("[auth] Login exception:", err);
      return { success: false, error: "حدث خطأ في الاتصال — تأكد من اتصال الإنترنت" };
    }
  },
  logout: () => {
    localStorage.removeItem("lms_token");
    localStorage.removeItem("lms_role");
    localStorage.removeItem("lms_mod_id");
    localStorage.removeItem("lms_mod_perms");
    localStorage.removeItem("lms_mod_name");
    localStorage.removeItem("lms_mod_dept");
    localStorage.removeItem("lms_mod_year");
  },
};

// ============ DATA API (Live Cloudflare D1 + R2) ============
export const db = {
  // Departments
  getDepartments: async (): Promise<Department[]> => {
    try {
      const data = await apiGet<Department[]>("/api/db/departments");
      if (Array.isArray(data) && data.length > 0) return data;
    } catch (e) {
      console.warn("getDepartments fallback:", e);
    }
    return fallbackDepartments;
  },

  // Material Categories
  getCategories: async (): Promise<MaterialCategory[]> => {
    try {
      const data = await apiGet<MaterialCategory[]>("/api/db/categories");
      if (Array.isArray(data) && data.length > 0) return data;
    } catch (e) {
      console.warn("getCategories fallback:", e);
    }
    return fallbackCategories;
  },
  addCategory: async (cat: { name_ar: string; name_en: string; department_id?: string | null; academic_year?: string | null }) => {
    return await apiMutate<MaterialCategory>("/api/db/categories", "POST", cat);
  },
  updateCategory: async (id: string, updates: Partial<Pick<MaterialCategory, "name_ar" | "name_en" | "department_id" | "academic_year">>) => {
    await apiMutate(`/api/db/categories/${encodeURIComponent(id)}`, "PATCH", updates);
  },
  deleteCategory: async (id: string) => {
    await apiMutate(`/api/db/categories/${encodeURIComponent(id)}`, "DELETE");
  },
  reorderCategories: async (orderedIds: string[]) => {
    await apiMutate("/api/db/categories/reorder", "POST", { orderedIds });
  },

  // Courses
  getCourses: async (): Promise<Course[]> => {
    try {
      const data = await apiGet<Course[]>("/api/db/courses");
      if (Array.isArray(data) && data.length > 0) return data;
    } catch (e) {
      console.warn("getCourses fallback:", e);
    }
    return fallbackCourses;
  },
  getCoursesByDepartment: async (departmentId: string): Promise<Course[]> => {
    const targetId = normalizeDeptId(departmentId);
    try {
      const data = await apiGet<Course[]>(`/api/db/courses?department_id=${encodeURIComponent(targetId)}`);
      if (Array.isArray(data)) return data;
    } catch (e) {
      console.warn("getCoursesByDepartment fallback:", e);
    }
    return fallbackCourses.filter((c) => !targetId || c.department_id === targetId);
  },
  addCourse: async (course: {
    name: string;
    code: string;
    description: string;
    description_ar?: string;
    department_id?: string | null;
    academic_year: string;
    semester: string;
    notes?: string | null;
  }) => {
    const color = COURSE_COLORS[Math.floor(Math.random() * COURSE_COLORS.length)];
    return await apiMutate<Course>("/api/db/courses", "POST", { ...course, color });
  },
  updateCourse: async (
    id: string,
    updates: Partial<Pick<Course, "name" | "code" | "description" | "description_ar" | "department_id" | "academic_year" | "semester" | "notes">>
  ) => {
    await apiMutate(`/api/db/courses/${encodeURIComponent(id)}`, "PATCH", updates);
  },
  deleteCourse: async (id: string) => {
    await apiMutate(`/api/db/courses/${encodeURIComponent(id)}`, "DELETE");
  },

  // Materials
  getMaterials: async (courseId?: string): Promise<Material[]> => {
    try {
      const qs = courseId ? `?course_id=${encodeURIComponent(courseId)}` : "";
      const data = await apiGet<Material[]>(`/api/db/materials${qs}`);
      if (Array.isArray(data)) return data;
    } catch (e) {
      console.warn("getMaterials fallback:", e);
    }
    return courseId ? fallbackMaterials.filter((m) => m.course_id === courseId) : fallbackMaterials;
  },
  getMaterialsByDepartment: async (departmentId: string): Promise<Material[]> => {
    const targetId = normalizeDeptId(departmentId);
    try {
      const data = await apiGet<Material[]>(`/api/db/materials?department_id=${encodeURIComponent(targetId)}`);
      if (Array.isArray(data)) return data;
    } catch (e) {
      console.warn("getMaterialsByDepartment fallback:", e);
    }
    const deptCourseIds = new Set(
      fallbackCourses.filter((c) => c.department_id === targetId).map((c) => c.id)
    );
    return fallbackMaterials.filter((m) => deptCourseIds.has(m.course_id));
  },
  getMaterialUrlsForCourses: async (courseIds: string[]): Promise<string[]> => {
    if (courseIds.length === 0) return [];
    try {
      const data = await apiGet<string[]>(
        `/api/db/material-urls?course_ids=${encodeURIComponent(courseIds.join(","))}`
      );
      if (Array.isArray(data)) return data;
    } catch {}
    const cSet = new Set(courseIds);
    return fallbackMaterials
      .filter((m) => cSet.has(m.course_id) && !m.archived)
      .map((m) => m.pdf_url)
      .filter(Boolean) as string[];
  },
  addMaterial: async (material: {
    title: string;
    type: string;
    course_id: string;
    category_id?: string | null;
    pdf_url?: string | null;
    pdf_display_name?: string | null;
    external_link?: string | null;
    submission_link?: string | null;
    deadline?: string | null;
    is_assignment?: boolean;
    is_list?: boolean;
    list_content?: string | null;
    is_reference?: boolean | null;
    section_number?: string | null;
    notes?: string | null;
    video_url?: string | null;
  }) => {
    return await apiMutate<Material>("/api/db/materials", "POST", material);
  },
  updateMaterial: async (
    id: string,
    updates: {
      title?: string;
      course_id?: string;
      category_id?: string | null;
      pdf_url?: string | null;
      pdf_display_name?: string | null;
      external_link?: string | null;
      submission_link?: string | null;
      deadline?: string | null;
      is_assignment?: boolean;
      is_list?: boolean;
      is_reference?: boolean;
      list_content?: string | null;
      section_number?: string | null;
      notes?: string | null;
      video_url?: string | null;
    }
  ) => {
    await apiMutate(`/api/db/materials/${encodeURIComponent(id)}`, "PATCH", updates);
  },
  archiveMaterial: async (id: string) => {
    await apiMutate(`/api/db/materials/${encodeURIComponent(id)}`, "PATCH", { archived: true });
  },
  unarchiveMaterial: async (id: string) => {
    await apiMutate(`/api/db/materials/${encodeURIComponent(id)}`, "PATCH", { archived: false });
  },
  deleteMaterial: async (id: string) => {
    await apiMutate(`/api/db/materials/${encodeURIComponent(id)}`, "DELETE");
  },
  restoreMaterial: async (id: string) => {
    await apiMutate(`/api/db/materials/${encodeURIComponent(id)}/restore`, "POST");
  },
  getMaterialById: async (id: string): Promise<Material | null> => {
    try {
      return await apiGet<Material | null>(`/api/db/materials/${encodeURIComponent(id)}`);
    } catch {
      return fallbackMaterials.find((m) => m.id === id) || null;
    }
  },
  reorderMaterials: async (orderedIds: string[]) => {
    await apiMutate("/api/db/materials/reorder", "POST", { orderedIds });
  },

  // Links
  getLinks: async (departmentId?: string | null): Promise<ImportantLink[]> => {
    try {
      const qs = departmentId ? `?department_id=${encodeURIComponent(departmentId)}` : "";
      const data = await apiGet<ImportantLink[]>(`/api/db/links${qs}`);
      if (Array.isArray(data)) return data;
    } catch {}
    return [];
  },
  addLink: async (link: { title: string; title_ar?: string | null; url: string; department_id?: string | null }) => {
    return await apiMutate<ImportantLink>("/api/db/links", "POST", link);
  },
  removeLink: async (id: string) => {
    await apiMutate(`/api/db/links/${encodeURIComponent(id)}`, "DELETE");
  },

  // Moderators
  getModerators: async (): Promise<Moderator[]> => {
    try {
      return await apiGet<Moderator[]>("/api/db/moderators");
    } catch {
      return [];
    }
  },
  addModerator: async (mod: {
    username: string;
    password: string;
    display_name: string;
    permissions: Permission[];
    department_id?: string | null;
    academic_year: string;
  }) => {
    return await apiMutate<Moderator>("/api/db/moderators", "POST", mod);
  },
  deleteModerator: async (id: string) => {
    await apiMutate(`/api/db/moderators/${encodeURIComponent(id)}`, "DELETE");
  },
  updateModerator: async (
    id: string,
    updates: { permissions?: Permission[]; department_id?: string | null; academic_year?: string }
  ) => {
    await apiMutate(`/api/db/moderators/${encodeURIComponent(id)}`, "PATCH", updates);
  },
  updateModeratorPassword: async (id: string, newPassword: string) => {
    await apiMutate(`/api/db/moderators/${encodeURIComponent(id)}/password`, "POST", { password: newPassword });
  },
  syncLegacyModerators: async (username: string, password: string): Promise<{ ok: boolean; synced: number; accessSynced: number }> => {
    return await apiMutate("/api/db/moderators/sync-legacy", "POST", { username, password });
  },
  setModeratorCourseAccess: async (moderatorId: string, courseIds: string[]) => {
    await apiMutate(`/api/db/moderator-course-access/${encodeURIComponent(moderatorId)}`, "PUT", { courseIds });
  },

  // Moderator Course Access
  getModeratorCourseAccess: async (moderatorId: string): Promise<ModeratorCourseAccess[]> => {
    try {
      return await apiGet<ModeratorCourseAccess[]>(
        `/api/db/moderator-course-access?moderator_id=${encodeURIComponent(moderatorId)}`
      );
    } catch {
      return [];
    }
  },
  getAllModeratorCourseAccess: async (): Promise<ModeratorCourseAccess[]> => {
    try {
      return await apiGet<ModeratorCourseAccess[]>("/api/db/moderator-course-access");
    } catch {
      return [];
    }
  },
  addModeratorCourseAccess: async (moderatorId: string, courseId: string) => {
    await apiMutate("/api/db/moderator-course-access", "POST", { moderator_id: moderatorId, course_id: courseId });
  },
  removeModeratorCourseAccess: async (id: string) => {
    await apiMutate(`/api/db/moderator-course-access/${encodeURIComponent(id)}`, "DELETE");
  },

  // Shared Department Courses
  getSharedCoursesForDept: async (targetDeptId: string): Promise<string[]> => {
    try {
      const rows = await apiGet<{ course_id: string }[]>(
        `/api/db/shared-courses?target_department_id=${encodeURIComponent(targetDeptId)}`
      );
      return rows.map((r) => r.course_id);
    } catch {
      return [];
    }
  },
  getTargetDepartmentsForCourse: async (courseId: string): Promise<string[]> => {
    try {
      const rows = await apiGet<{ target_department_id: string }[]>(
        `/api/db/shared-courses?course_id=${encodeURIComponent(courseId)}`
      );
      return rows.map((r) => r.target_department_id);
    } catch {
      return [];
    }
  },
  getAllSharedDeptCourses: async (): Promise<{ id: string; course_id: string; target_department_id: string }[]> => {
    try {
      return await apiGet(`/api/db/shared-courses`);
    } catch {
      return [];
    }
  },
  setSharedCoursesForDept: async (targetDeptId: string, courseIds: string[]) => {
    await apiMutate(`/api/db/shared-courses/by-dept/${encodeURIComponent(targetDeptId)}`, "PUT", { courseIds });
  },
  setTargetDepartmentsForCourse: async (courseId: string, targetDeptIds: string[]) => {
    await apiMutate(`/api/db/shared-courses/by-course/${encodeURIComponent(courseId)}`, "PUT", { targetDeptIds });
  },

  // Notifications
  getNotifications: async (): Promise<Notification[]> => {
    try {
      return await apiGet<Notification[]>("/api/db/notifications");
    } catch {
      return [];
    }
  },
  addNotification: async (notif: {
    title: string;
    message: string;
    target_audience: string;
    target_year?: string | null;
    link?: string | null;
    sent_by?: string;
  }) => {
    return await apiMutate<Notification>("/api/db/notifications", "POST", notif);
  },

  // Notification Templates
  getNotificationTemplates: async (): Promise<NotificationTemplate[]> => {
    try {
      return await apiGet<NotificationTemplate[]>("/api/db/notification-templates");
    } catch {
      return [];
    }
  },
  updateNotificationTemplate: async (id: string, title_template: string, message_template: string) => {
    await apiMutate(`/api/db/notification-templates/${encodeURIComponent(id)}`, "PATCH", {
      title_template,
      message_template,
    });
  },

  // Announcements
  getAnnouncements: async (): Promise<Announcement[]> => {
    try {
      return await apiGet<Announcement[]>("/api/db/announcements");
    } catch {
      return [];
    }
  },
  addAnnouncement: async (announcement: {
    content: string;
    expires_at: string;
    link?: string | null;
    target_year?: string | null;
    target_dept?: string | null;
    color?: string | null;
  }) => {
    await apiMutate("/api/db/announcements", "POST", announcement);
  },
  deleteAnnouncement: async (id: string) => {
    await apiMutate(`/api/db/announcements/${encodeURIComponent(id)}`, "DELETE");
  },

  // Audit Logs
  addAuditLog: async (
    action: string,
    details: string,
    options?: {
      action_type?: string;
      related_material_id?: string;
      material_snapshot?: Record<string, any>;
    }
  ) => {
    if (!auth.isLoggedIn()) return;
    try {
      await apiMutate("/api/db/audit-logs", "POST", {
        action,
        details,
        action_type: options?.action_type || "other",
        related_material_id: options?.related_material_id || null,
        material_snapshot: options?.material_snapshot || null,
      });
    } catch (e) {
      console.warn("Audit log failed:", e);
    }
  },

  getAuditLogs: async (limit = 200): Promise<any[]> => {
    try {
      return await apiGet<any[]>(`/api/db/audit-logs?limit=${limit}`);
    } catch {
      return [];
    }
  },

  // Storage (Direct Cloudflare R2 uploads via Worker)
  sanitizeFileName: (name: string): string => {
    const ext = name.lastIndexOf(".") >= 0 ? name.slice(name.lastIndexOf(".")) : "";
    const base = name.lastIndexOf(".") >= 0 ? name.slice(0, name.lastIndexOf(".")) : name;
    const clean = base.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || "file";
    return `${Date.now()}-${clean}${ext}`;
  },

  ALLOWED_UPLOAD_TYPES: [
    "application/pdf",
    "video/mp4", "video/webm", "video/ogg", "video/quicktime",
    "audio/mpeg", "audio/wav", "audio/aac", "audio/x-m4a", "audio/m4a", "audio/ogg",
    "image/png", "image/jpeg", "image/webp", "image/gif",
  ] as const,

  uploadPdf: async (file: File, onProgress?: (percent: number) => void): Promise<string> => {
    const allowedTypes: readonly string[] = db.ALLOWED_UPLOAD_TYPES;
    const allowedExtensions = [
      ".pdf", ".mp3", ".wav", ".m4a", ".aac", ".ogg",
      ".png", ".jpg", ".jpeg", ".webp", ".gif",
      ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
      ".mp4", ".webm", ".mkv", ".avi", ".mov", ".txt", ".zip", ".rar",
    ];
    const hasAllowedExtension = allowedExtensions.some((ext) => file.name.toLowerCase().endsWith(ext));
    if (!allowedTypes.includes(file.type as any) && !hasAllowedExtension) {
      throw new Error("نوع الملف غير مسموح به. يُسمح بملفات PDF، الفيديو، المستندات، الصور، والصوتيات.");
    }
    return await uploadFileToR2(file, onProgress);
  },

  uploadPdfSanitized: async (file: File, onProgress?: (percent: number) => void): Promise<string> => {
    return db.uploadPdf(file, onProgress);
  },
};

// Legacy compatibility
export const store = {
  ...auth,
  isAdmin: () => auth.isLoggedIn(),
};

/** Categories visible for a given department and academic year:
 * unified department (department_id null) + department-specific ones,
 * AND unified year (academic_year null) + year-specific ones. */
export function categoriesForDepartment(
  categories: MaterialCategory[],
  departmentId?: string | null,
  academicYear?: string | null
): MaterialCategory[] {
  return categories.filter((c) => {
    const matchesDept = !c.department_id || (departmentId && c.department_id === departmentId);
    const matchesYear = !c.academic_year || (academicYear && c.academic_year === academicYear);
    return matchesDept && matchesYear;
  });
}
