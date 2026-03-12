from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
import sqlite3
import os

app = FastAPI(title="Cosmic Tasks API")

DB_PATH = "tasks.db"


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            priority TEXT DEFAULT 'medium',
            completed INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Seed demo data
    count = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
    if count == 0:
        demo_tasks = [
            ("Launch rocket to Mars", "Prepare all systems for interplanetary mission", "high", 0),
            ("Calibrate telescope", "Align mirrors for deep space observation", "medium", 0),
            ("Analyze asteroid samples", "Study composition of recently captured asteroid", "high", 1),
            ("Train astronaut crew", "Run simulations for EVA procedures", "medium", 0),
            ("Update navigation charts", "Incorporate new star mapping data", "low", 1),
        ]
        conn.executemany(
            "INSERT INTO tasks (title, description, priority, completed) VALUES (?,?,?,?)",
            demo_tasks
        )
    conn.commit()
    conn.close()


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    priority: Optional[str] = "medium"


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    completed: Optional[bool] = None


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@app.get("/api/tasks")
def list_tasks():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM tasks ORDER BY completed ASC, created_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/tasks", status_code=201)
def create_task(task: TaskCreate):
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO tasks (title, description, priority) VALUES (?,?,?)",
        (task.title, task.description, task.priority)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM tasks WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


@app.patch("/api/tasks/{task_id}")
def update_task(task_id: int, task: TaskUpdate):
    conn = get_conn()
    row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    fields = {k: v for k, v in task.model_dump().items() if v is not None}
    if "completed" in fields:
        fields["completed"] = int(fields["completed"])
    if fields:
        sets = ", ".join(f"{k}=?" for k in fields)
        conn.execute(f"UPDATE tasks SET {sets} WHERE id=?", (*fields.values(), task_id))
        conn.commit()
    row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    conn.close()
    return dict(row)


@app.delete("/api/tasks/{task_id}", status_code=204)
def delete_task(task_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
    conn.commit()
    conn.close()


@app.get("/api/stats")
def get_stats():
    conn = get_conn()
    total = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
    done = conn.execute("SELECT COUNT(*) FROM tasks WHERE completed=1").fetchone()[0]
    high = conn.execute("SELECT COUNT(*) FROM tasks WHERE priority='high' AND completed=0").fetchone()[0]
    conn.close()
    return {"total": total, "completed": done, "pending": total - done, "high_priority": high}


app.mount("/", StaticFiles(directory="static", html=True), name="static")

init_db()
