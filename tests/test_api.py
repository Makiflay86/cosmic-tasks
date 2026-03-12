"""
Comprehensive pytest tests for the Cosmic Tasks FastAPI backend.

Each test gets a fresh, isolated SQLite database via the `client` fixture,
which monkeypatches main.DB_PATH to a temporary file before calling init_db().
"""

import sqlite3
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    import main
    db_file = str(tmp_path / "test_tasks.db")
    monkeypatch.setattr(main, "DB_PATH", db_file)
    main.init_db()
    yield TestClient(main.app)


@pytest.fixture()
def empty_client(tmp_path, monkeypatch):
    import main
    db_file = str(tmp_path / "test_tasks.db")
    monkeypatch.setattr(main, "DB_PATH", db_file)
    main.init_db()
    yield TestClient(main.app), db_file


def _create_task(client, title="Test Task", description="desc", priority="medium"):
    return client.post("/api/tasks", json={"title": title, "description": description, "priority": priority})


class TestInitDb:
    def test_table_is_created(self, tmp_path, monkeypatch):
        import main
        db_file = str(tmp_path / "fresh.db")
        monkeypatch.setattr(main, "DB_PATH", db_file)
        main.init_db()
        conn = sqlite3.connect(db_file)
        tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").fetchall()
        conn.close()
        assert len(tables) == 1

    def test_seed_data_inserted_on_first_call(self, tmp_path, monkeypatch):
        import main
        db_file = str(tmp_path / "seed.db")
        monkeypatch.setattr(main, "DB_PATH", db_file)
        main.init_db()
        conn = sqlite3.connect(db_file)
        count = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
        conn.close()
        assert count == 5

    def test_seed_data_not_duplicated_on_second_call(self, tmp_path, monkeypatch):
        import main
        db_file = str(tmp_path / "seed_dup.db")
        monkeypatch.setattr(main, "DB_PATH", db_file)
        main.init_db()
        main.init_db()
        conn = sqlite3.connect(db_file)
        count = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
        conn.close()
        assert count == 5

    def test_seed_titles_present(self, tmp_path, monkeypatch):
        import main
        db_file = str(tmp_path / "seed_titles.db")
        monkeypatch.setattr(main, "DB_PATH", db_file)
        main.init_db()
        conn = sqlite3.connect(db_file)
        titles = {r[0] for r in conn.execute("SELECT title FROM tasks").fetchall()}
        conn.close()
        expected = {"Launch rocket to Mars", "Calibrate telescope", "Analyze asteroid samples", "Train astronaut crew", "Update navigation charts"}
        assert expected == titles


class TestListTasks:
    def test_returns_list(self, client):
        response = client.get("/api/tasks")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_returns_all_seed_tasks(self, client):
        assert len(client.get("/api/tasks").json()) == 5

    def test_task_fields_present(self, client):
        tasks = client.get("/api/tasks").json()
        required_fields = {"id", "title", "description", "priority", "completed", "created_at"}
        for task in tasks:
            assert required_fields.issubset(task.keys())

    def test_ordering_incomplete_before_completed(self, client):
        tasks = client.get("/api/tasks").json()
        first_completed_idx = next((i for i, t in enumerate(tasks) if t["completed"] == 1), len(tasks))
        for task in tasks[:first_completed_idx]:
            assert task["completed"] == 0
        for task in tasks[first_completed_idx:]:
            assert task["completed"] == 1

    def test_ordering_within_completed_group_by_date_desc(self, client):
        tasks = client.get("/api/tasks").json()
        for group in ([t for t in tasks if t["completed"] == 0], [t for t in tasks if t["completed"] == 1]):
            dates = [t["created_at"] for t in group]
            assert dates == sorted(dates, reverse=True)

    def test_newly_created_task_appears_in_incomplete_group(self, client):
        _create_task(client, title="Brand New Task")
        incomplete_titles = [t["title"] for t in client.get("/api/tasks").json() if t["completed"] == 0]
        assert "Brand New Task" in incomplete_titles

    def test_newly_created_task_not_in_completed_group(self, client):
        _create_task(client, title="Brand New Task")
        completed_titles = [t["title"] for t in client.get("/api/tasks").json() if t["completed"] == 1]
        assert "Brand New Task" not in completed_titles


class TestCreateTask:
    def test_creates_task_returns_201(self, client):
        assert _create_task(client, title="New Task").status_code == 201

    def test_creates_task_with_all_fields(self, client):
        body = _create_task(client, title="Explore Nebula", description="A new nebula", priority="high").json()
        assert body["title"] == "Explore Nebula"
        assert body["description"] == "A new nebula"
        assert body["priority"] == "high"

    def test_creates_task_with_defaults(self, client):
        body = client.post("/api/tasks", json={"title": "Minimal Task"}).json()
        assert body["description"] == ""
        assert body["priority"] == "medium"

    def test_new_task_is_incomplete_by_default(self, client):
        assert _create_task(client, title="Incomplete Task").json()["completed"] == 0

    def test_new_task_receives_an_id(self, client):
        assert isinstance(_create_task(client, title="ID Task").json()["id"], int)

    def test_new_task_has_created_at(self, client):
        body = _create_task(client, title="Timestamp Task").json()
        assert body.get("created_at") is not None

    def test_rejects_missing_title(self, client):
        assert client.post("/api/tasks", json={"description": "No title", "priority": "low"}).status_code == 422

    def test_rejects_empty_body(self, client):
        assert client.post("/api/tasks", json={}).status_code == 422

    def test_task_persisted_in_list(self, client):
        _create_task(client, title="Persisted Task")
        assert "Persisted Task" in [t["title"] for t in client.get("/api/tasks").json()]


class TestUpdateTask:
    def _get_first_incomplete_id(self, client):
        return next(t["id"] for t in client.get("/api/tasks").json() if t["completed"] == 0)

    def _get_first_completed_id(self, client):
        return next(t["id"] for t in client.get("/api/tasks").json() if t["completed"] == 1)

    def test_update_title(self, client):
        task_id = self._get_first_incomplete_id(client)
        response = client.patch(f"/api/tasks/{task_id}", json={"title": "Updated Title"})
        assert response.status_code == 200
        assert response.json()["title"] == "Updated Title"

    def test_update_description(self, client):
        task_id = self._get_first_incomplete_id(client)
        assert client.patch(f"/api/tasks/{task_id}", json={"description": "New description"}).json()["description"] == "New description"

    def test_update_priority(self, client):
        task_id = self._get_first_incomplete_id(client)
        assert client.patch(f"/api/tasks/{task_id}", json={"priority": "low"}).json()["priority"] == "low"

    def test_update_completed_to_true(self, client):
        task_id = self._get_first_incomplete_id(client)
        assert client.patch(f"/api/tasks/{task_id}", json={"completed": True}).json()["completed"] == 1

    def test_update_completed_to_false(self, client):
        task_id = self._get_first_completed_id(client)
        assert client.patch(f"/api/tasks/{task_id}", json={"completed": False}).json()["completed"] == 0

    def test_returns_404_for_unknown_id(self, client):
        assert client.patch("/api/tasks/999999", json={"title": "Ghost"}).status_code == 404

    def test_404_error_detail(self, client):
        assert "detail" in client.patch("/api/tasks/999999", json={"title": "Ghost"}).json()

    def test_partial_update_only_changes_specified_field(self, client):
        task_id = self._get_first_incomplete_id(client)
        original = next(t for t in client.get("/api/tasks").json() if t["id"] == task_id)
        client.patch(f"/api/tasks/{task_id}", json={"title": "Only Title Changed"})
        updated = next(t for t in client.get("/api/tasks").json() if t["id"] == task_id)
        assert updated["title"] == "Only Title Changed"
        assert updated["description"] == original["description"]
        assert updated["priority"] == original["priority"]

    def test_update_multiple_fields_at_once(self, client):
        task_id = self._get_first_incomplete_id(client)
        body = client.patch(f"/api/tasks/{task_id}", json={"title": "Multi Update", "priority": "high", "completed": True}).json()
        assert body["title"] == "Multi Update"
        assert body["priority"] == "high"
        assert body["completed"] == 1

    def test_returns_updated_task_object(self, client):
        task_id = self._get_first_incomplete_id(client)
        body = client.patch(f"/api/tasks/{task_id}", json={"title": "Full Object"}).json()
        assert {"id", "title", "description", "priority", "completed", "created_at"}.issubset(body.keys())


class TestDeleteTask:
    def test_delete_existing_task_returns_204(self, client):
        task_id = client.get("/api/tasks").json()[0]["id"]
        assert client.delete(f"/api/tasks/{task_id}").status_code == 204

    def test_delete_removes_task_from_list(self, client):
        task_id = client.get("/api/tasks").json()[0]["id"]
        client.delete(f"/api/tasks/{task_id}")
        assert task_id not in [t["id"] for t in client.get("/api/tasks").json()]

    def test_delete_204_has_no_body(self, client):
        task_id = client.get("/api/tasks").json()[0]["id"]
        assert client.delete(f"/api/tasks/{task_id}").content == b""

    def test_delete_nonexistent_id_returns_204(self, client):
        assert client.delete("/api/tasks/999999").status_code == 204

    def test_delete_reduces_task_count(self, client):
        before = len(client.get("/api/tasks").json())
        client.delete(f"/api/tasks/{client.get('/api/tasks').json()[0]['id']}")
        assert len(client.get("/api/tasks").json()) == before - 1

    def test_double_delete_is_idempotent(self, client):
        task_id = client.get("/api/tasks").json()[0]["id"]
        assert client.delete(f"/api/tasks/{task_id}").status_code == 204
        assert client.delete(f"/api/tasks/{task_id}").status_code == 204


class TestGetStats:
    def test_returns_200(self, client):
        assert client.get("/api/stats").status_code == 200

    def test_response_has_required_keys(self, client):
        assert {"total", "completed", "pending", "high_priority"}.issubset(client.get("/api/stats").json().keys())

    def test_correct_total_from_seed(self, client):
        assert client.get("/api/stats").json()["total"] == 5

    def test_correct_completed_count_from_seed(self, client):
        assert client.get("/api/stats").json()["completed"] == 2

    def test_correct_pending_count_from_seed(self, client):
        assert client.get("/api/stats").json()["pending"] == 3

    def test_total_equals_completed_plus_pending(self, client):
        stats = client.get("/api/stats").json()
        assert stats["total"] == stats["completed"] + stats["pending"]

    def test_high_priority_counts_only_incomplete_high_tasks(self, client):
        assert client.get("/api/stats").json()["high_priority"] == 1

    def test_stats_after_creating_task(self, client):
        before = client.get("/api/stats").json()
        _create_task(client, title="Extra Task", priority="low")
        after = client.get("/api/stats").json()
        assert after["total"] == before["total"] + 1
        assert after["pending"] == before["pending"] + 1

    def test_stats_after_creating_high_priority_incomplete_task(self, client):
        before = client.get("/api/stats").json()
        _create_task(client, title="Urgent Task", priority="high")
        assert client.get("/api/stats").json()["high_priority"] == before["high_priority"] + 1

    def test_stats_after_deleting_task(self, client):
        incomplete = next(t for t in client.get("/api/tasks").json() if t["completed"] == 0)
        before = client.get("/api/stats").json()
        client.delete(f"/api/tasks/{incomplete['id']}")
        after = client.get("/api/stats").json()
        assert after["total"] == before["total"] - 1
        assert after["pending"] == before["pending"] - 1

    def test_stats_after_completing_task(self, client):
        incomplete_id = next(t["id"] for t in client.get("/api/tasks").json() if t["completed"] == 0)
        before = client.get("/api/stats").json()
        client.patch(f"/api/tasks/{incomplete_id}", json={"completed": True})
        after = client.get("/api/stats").json()
        assert after["completed"] == before["completed"] + 1
        assert after["pending"] == before["pending"] - 1

    def test_high_priority_not_incremented_for_completed_high_task(self, client):
        before = client.get("/api/stats").json()
        new_task = _create_task(client, title="Done High", priority="high").json()
        client.patch(f"/api/tasks/{new_task['id']}", json={"completed": True})
        assert client.get("/api/stats").json()["high_priority"] == before["high_priority"]

    def test_stats_empty_db(self, tmp_path, monkeypatch):
        import main
        db_file = str(tmp_path / "empty_stats.db")
        monkeypatch.setattr(main, "DB_PATH", db_file)
        conn = sqlite3.connect(db_file)
        conn.execute("CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT DEFAULT '', priority TEXT DEFAULT 'medium', completed INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)")
        conn.commit()
        conn.close()
        stats = TestClient(main.app).get("/api/stats").json()
        assert stats["total"] == 0
        assert stats["completed"] == 0
        assert stats["pending"] == 0
        assert stats["high_priority"] == 0
