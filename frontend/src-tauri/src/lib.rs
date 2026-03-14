use std::net::TcpListener;
use std::sync::Mutex;
use tauri_plugin_shell::ShellExt;

struct AppState {
    api_url: Mutex<String>,
}

#[tauri::command]
fn get_api_url(state: tauri::State<AppState>) -> String {
    state.api_url.lock().unwrap().clone()
}

fn find_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("Failed to bind to a free port")
        .local_addr()
        .expect("Failed to get local address")
        .port()
}

pub fn run() {
    let port = find_free_port();
    let api_url = format!("http://127.0.0.1:{}", port);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            api_url: Mutex::new(api_url.clone()),
        })
        .invoke_handler(tauri::generate_handler![get_api_url])
        .setup(move |app| {
            // Set PORT env var so sidecar inherits it
            std::env::set_var("PORT", port.to_string());

            let shell = app.shell();
            let (mut _rx, _child) = shell
                .sidecar("backend")
                .expect("Failed to find backend sidecar binary")
                .spawn()
                .expect("Failed to spawn backend sidecar");

            println!("Backend started on port {}", port);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error while running Tauri application");
}
