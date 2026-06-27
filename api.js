const API = 'http://localhost:3000/api';

async function apiGet(path) {
    const res = await fetch(`${API}${path}`);
    return res.json();
}

async function apiPost(path, data) {
    const res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return res.json();
}

async function apiPut(path, data) {
    const res = await fetch(`${API}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return res.json();
}

async function apiDelete(path) {
    const res = await fetch(`${API}${path}`, {
        method: 'DELETE'
    });
    return res.json();
}