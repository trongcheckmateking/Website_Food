# Quán ăn của Dì

Một repo gồm backend Rust/Axum và frontend React/TypeScript. Màn hình đầu tiên kiểm tra kết nối giữa hai phần.

## Chạy trên máy

Cài Rust stable qua rustup và Node.js 22.12 trở lên. Mở hai terminal tại thư mục chứa README này.

Trong terminal thứ nhất, khởi động API.

```sh
cd backend
cargo run
```

Trong terminal thứ hai, khởi động giao diện.

```sh
cd frontend
npm install
npm run dev
```

Mở địa chỉ Local do Vite in ra. Khi cả hai tiến trình đang chạy, trang sẽ hiện “Đã kết nối backend.” Để kiểm tra riêng API, mở http://127.0.0.1:3000/api/health và xem kết quả `ok`.

## Tổ chức mã nguồn

Thêm các module nghiệp vụ vào `backend/src/` và màn hình tương ứng vào `frontend/src/` khi phát triển chức năng. Chạy `git init` một lần ở thư mục chứa README sau khi giải nén để quản lý cả hai phần trong cùng một repo.
