# Bếp nhà Dì

Website đặt món làm sẵn cho quán gia đình. Khách mở đường dẫn riêng của quán, ví dụ `/quan/quan-cua-di`, chọn món và topping, ghi chú rồi chọn đến lấy hoặc giao tận nhà. Chủ quán dùng trình duyệt trên điện thoại hoặc laptop để cập nhật tồn, chốt đơn và trả lời khách.

## Chạy lần đầu

Cần Git, Rust stable và Cargo, Node.js 22.12 trở lên với npm, PostgreSQL và một dự án Supabase Auth. Docker Compose là lựa chọn để chạy PostgreSQL trên máy. Trong các lệnh bên dưới, bắt đầu ở thư mục chứa README. Nếu tải ZIP, giải nén trước.

1. Tạo dự án Supabase. Trong Authentication, bật email/password và xác minh email. Tạo một người dùng đã xác minh cho Dì rồi sao chép **User UID**. Lấy **Project URL** và **publishable/anon key** ở cấu hình API. Dùng PostgreSQL riêng cho dữ liệu bán hàng. Supabase trong kiến trúc này quản lý danh tính.
2. Khởi động cơ sở dữ liệu cục bộ và tạo cấu hình backend.

   ```sh
   docker compose up -d db
   cd backend
   cp .env.example .env
   ```

3. Trong `backend/.env`, điền `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SHOP_OWNER_ID` và `SHOP_ORIGIN` bằng tọa độ quán dạng `10.77,106.69`. Đây chỉ là ví dụ về định dạng. `SHOP_NAME` là tên hiển thị. `SHOP_SLUG` là phần cuối của link, `DEFAULT_SHOP` là quán được mở từ trang gốc. Trên Supabase, thêm URL chuyển hướng chính xác, ví dụ `http://localhost:5173/quan/quan-cua-di`. Đặt Site URL theo môi trường.
4. Trong terminal đang ở `backend/`, tạo quán và chạy API.

   ```sh
   cargo run --locked -- setup-shop
   cargo run --locked
   ```

   Khi khởi động, API tự chạy migration. Lệnh setup có thể chạy lại để cập nhật cấu hình quán. Lệnh này có quyền đổi chủ và tài khoản nhận tiền, vì vậy chỉ người vận hành máy chủ thực hiện.
5. Mở terminal thứ hai ở gốc repo.

   ```sh
   cd frontend
   npm ci
   npm run dev
   ```

   Mở `http://localhost:5173/quan/quan-cua-di`. Đăng nhập tài khoản của Dì, chọn **Quản lý → Thêm món**. Nhập tên, giá, số phần và topping. Đăng xuất hoặc mở cửa sổ riêng tư để thử với tài khoản khách. Nếu đổi cổng Vite, cập nhật URL chuyển hướng ở Supabase.

**Lần thử đầu tiên** có thể dùng email/password, đến lấy và tiền mặt. Tạo món “Đậu hũ” giá 15.000đ, tồn 5, thêm topping “Trân châu” giá 2.000đ. Khách đặt hai ly cùng topping sẽ thấy tổng 34.000đ. Khi đơn được gửi, tồn còn 3. Dì chốt và bấm **Đã giao món và thu tiền**. Khách mở lại đơn sẽ thấy phần đánh giá.

## Bản đồ mã nguồn

| Vị trí | Trách nhiệm |
| --- | --- |
| `backend/src/main.rs` | Ghép các route Axum, xác minh phiên qua Supabase, kiểm tra quyền chủ quán, chạy tác vụ nền và phục vụ giao diện đã build. |
| `backend/src/setup.rs` | Tạo hoặc cập nhật cấu hình quán, gán chủ quán theo UID. |
| `backend/src/catalog.rs` | Menu công khai, giá, topping, điều chỉnh tồn, bán tại quầy và cài đặt phí giao. |
| `backend/src/orders.rs` | Kiểm tra giỏ, giữ hàng, duyệt tổng mới, hủy/trả tồn, thu tiền mặt, chat và đánh giá. |
| `backend/src/services.rs` | Báo giá giao theo đường đi, đối soát webhook SePay, đăng ký thiết bị và gửi OneSignal. |
| `backend/migrations/` | Lược đồ PostgreSQL và các thay đổi theo thứ tự. Tạo migration mới khi thay đổi bảng sau triển khai. |
| `frontend/src/api.ts` | Kiểu dữ liệu, phiên Supabase và hàm gọi API. Khóa riêng của nhà cung cấp được giữ ở backend. |
| `frontend/src/main.tsx` | Mở quán theo slug, điều hướng theo vai trò, giỏ theo quán và phiên tab. |
| `Account.tsx`, `Menu.tsx`, `Orders.tsx`, `Admin.tsx` trong `frontend/src/` | Tài khoản, menu/giỏ, theo dõi đơn/chat và thao tác của Dì. |
| `frontend/src/style.css` | Bố cục thích ứng cho điện thoại và laptop. |
| `backend/tests/` | Kiểm thử nhiều khách trên PostgreSQL và kiểm tra trình duyệt tùy chọn. |

Một repo chứa hai thư mục mã nguồn. Backend là một tiến trình Rust với các module nội bộ, dùng chung PostgreSQL. Một thay đổi như thêm phụ phí topping có thể sửa cả backend và frontend trong cùng một commit. Để mở quán thứ hai, tạo UID chủ quán, đổi biến `SHOP_*` rồi chạy lại `setup-shop` với slug mới. Mỗi quán có menu, cấu hình ngân hàng, phí giao, thiết bị nhận báo và đơn riêng.

## Quy tắc bán hàng

- **Tồn kho.** Đặt hàng và bán tại quầy dùng chung cột tồn. Backend trừ có điều kiện trong giao dịch PostgreSQL, kiểm tra toàn bộ món và topping rồi mới commit. Thêm món vào giỏ chưa giữ phần. Nếu gửi giỏ lại sau khi giá đổi, khách phải chọn lại món với giá hiện tại. Đơn lưu tên món, topping, giá mỗi phần và ghi chú tại thời điểm mua.
- **Đặt lại yêu cầu.** Trình duyệt gửi cùng khóa yêu cầu khi thử lại cùng giỏ sau lỗi mạng. Database và khóa giao dịch bảo đảm một yêu cầu tạo một đơn.
- **Tồn của topping.** Một công tắc cho từng topping trên từng món. Hết trân châu vẫn bán đậu hũ. **Bán tại quầy −1** trừ một phần. Màn hình sửa món nhận lượng tăng/giảm, ví dụ nhập `5` để bổ sung năm ly.
- **Giao hàng.** Goong tìm tọa độ từ địa chỉ và tính tuyến xe máy từ quán. Khách kiểm tra địa chỉ đã chuẩn hóa và phí trước khi gửi. Miễn phí đến 3.000m. Phần vượt tính 10.000đ cho mỗi 1.000m bắt đầu. Quán có thể đổi các giá trị này. Báo giá giữ 15 phút, gắn với đúng khách và quán, dùng một lần. Chọn đến lấy thì phí bằng 0.
- **Giữ phần.** Đơn chờ quán chốt trong 30 phút. Dì có thể chốt nguyên giá, từ chối hoặc đề xuất tổng khác kèm lý do. Đề xuất cần khách đồng ý và có hạn 30 phút. Hủy hoặc hết hạn trước khi chốt sẽ trả tồn một lần. Đơn đã chốt giữ phần cho tới giao. Trường hợp đổi món có thể trao đổi trong chat, hủy đơn đang chờ và đặt lại.
- **Tiền mặt.** Dì đánh dấu đã giao và đã thu tiền trong một thao tác. **QR** xuất hiện sau khi chốt. Khi tiền vào khớp đơn, API đánh dấu đã thanh toán. Trang chi tiết kiểm tra cập nhật mỗi ba giây. Chủ quán xác nhận giao riêng. Khi giao dịch lệch, kiểm tra ở SePay và bảng `transfers`.
- **Chat và đánh giá.** Người mua và chủ quán có thể xem lịch sử chat của đơn. Trang chi tiết lấy tin mới mỗi ba giây khi đang mở. Chỉ người mua của đơn đã hoàn tất được gửi một đánh giá cho mỗi món đã mua trong đơn đó. Nhận xét hiển thị ở thực đơn.
- **Đơn theo quán.** Đăng nhập để đặt hàng. Khách thấy đơn của mình tại quán đang mở. Dì thấy đơn của quán, danh sách hiển thị tối đa 200 đơn mới nhất. Dữ liệu cũ vẫn lưu trong PostgreSQL.

| Trạng thái | Ai thao tác | Bước tiếp theo |
| --- | --- | --- |
| Chờ quán xác nhận | Dì | Chốt, báo tổng khác hoặc hủy. Khách cũng có thể hủy. |
| Chờ khách duyệt | Người mua | Đồng ý tổng mới hoặc hủy. |
| Đã chốt đơn | Khách và Dì | Với QR, khách chuyển tiền và hệ thống đối soát. Với tiền mặt, Dì thu khi giao. |
| Đã nhận món | Người mua | Đánh giá từng món. |
| Đã hủy | Hệ thống | Tồn kho đã được trả lại. |

## Tích hợp dịch vụ thật

### Tài khoản, khôi phục mật khẩu và phân quyền

Dùng Supabase Auth cho email/password, Google và SMS OTP. Rust gọi `/auth/v1/user` với access token trước các thao tác riêng tư. UID xác thực quyết định quyền đối với từng quán và từng đơn. Trang cấu hình công khai chỉ trả URL, khóa **publishable/anon**, OneSignal App ID và slug mặc định. Không điền service-role key vào biến public. Bản triển khai giao việc băm và quản lý mật khẩu cho Supabase Auth.

1. Bật email confirmation, cấu hình SMTP của quán và giới hạn gửi/xác minh OTP. Đặt độ dài mật khẩu tối thiểu 10 ký tự và cấu hình giới hạn yêu cầu trong Supabase. Giao diện đăng ký cũng yêu cầu tối thiểu 10 ký tự.
2. Trong mẫu **Reset password**, dùng `{{ .Token }}` để email chứa mã. Khách chọn **Quên mật khẩu qua email**, nhập email, sau đó nhập mã và mật khẩu mới. Ứng dụng xác minh mã recovery trước khi đổi và yêu cầu đăng xuất toàn cục sau khi đổi thành công. Access token đã cấp có thời hạn riêng. Cấu hình thời hạn phiên phù hợp.
3. Trong Google Cloud, tạo OAuth client, thêm callback do Supabase cung cấp. Điền client ID và secret vào Google provider trên Supabase. Khai báo URL chuyển hướng của web ở allowlist cho môi trường chạy thật.
4. Cho SMS, bật Phone và kết nối SMS provider hỗ trợ gửi tới khách Việt Nam. Khách nhập số dạng `090...` hoặc `+8490...`. **Khôi phục qua SMS** gửi mã tới số đã liên kết và yêu cầu đặt mật khẩu mới sau khi xác minh. Khách chỉ đăng nhập bằng SMS có thể tiếp tục dùng OTP.
5. Trong tài khoản đã đăng nhập, khách có thể liên kết email, số điện thoại hoặc Google. Bật manual identity linking trên Supabase để dùng nút liên kết Google. Nhà cung cấp xử lý xác minh và liên kết danh tính. Kiểm tra lại bằng hai lần đăng nhập trên tài khoản thử để xác nhận cùng UID.

Tham khảo [Supabase Auth](https://supabase.com/docs/guides/auth), [OTP](https://supabase.com/docs/reference/javascript/auth-signinwithotp), [xác minh mã khôi phục](https://supabase.com/kb/troubleshooting/otp-verification-failures-token-has-expired-or-otp_expired-errors-5ee4d0).

### Goong

Điền REST API key vào `GOONG_API_KEY`. Đặt `SHOP_ORIGIN` đúng vị trí lấy hàng và chạy lại setup khi đổi địa chỉ quán. API lấy tọa độ bằng Geocode, rồi tính số mét bằng Directions. Khi dịch vụ chưa cấu hình hoặc lỗi, giao diện báo lỗi ở bước lấy phí. Khách vẫn có thể chọn đến lấy. [Goong Geocoding](https://document.goong.io/tutorial-Geocoding.html)

### SePay và QR

1. Kết nối tài khoản nhận tiền của quán trên SePay. Điền mã ngân hàng theo định dạng dịch vụ QR chấp nhận vào `SHOP_BANK`, số tài khoản vào `SHOP_ACCOUNT`.
2. Mỗi quán dùng một khóa webhook ngẫu nhiên riêng. Ví dụ `SHOP_WEBHOOK_ENV=SEPAY_KEY_DI` và `SEPAY_KEY_DI=<khóa riêng>`. Chạy lại `setup-shop`, rồi khởi động lại backend để nạp biến mới. Khi có nhiều quán, giữ các biến khóa của tất cả quán trong môi trường tiến trình.
3. Trong SePay Webhooks, chọn nhận giao dịch vào của tài khoản đó. Chọn phương thức API key có header `Authorization: Apikey <khóa riêng>`. Đặt endpoint `https://ten-mien-cua-ban/api/shop/quan-cua-di/webhook`. Thiết lập cấu trúc mã thanh toán để trường `code` trả về nguyên mã đơn **DH + 16 ký tự hex viết hoa** (0–9, A–F). Mã hiển thị trên đơn chính là nội dung khách cần giữ khi chuyển.
4. Trong sandbox của nhà cung cấp, gửi một giao dịch đúng mã/tài khoản/tổng tiền, rồi gửi lại cùng transaction ID. Kỳ vọng một lần ghi nhận thanh toán. Thử chuyển thiếu tiền, sai nội dung hoặc trước lúc quán xác nhận. Bảng `transfers` giữ các sự kiện tiền vào chưa khớp để đối soát thủ công. Đơn chỉ đổi trạng thái thanh toán khi mọi điều kiện khớp.
5. Khi đã kiểm tra sandbox, dùng cấu hình thật của quán và đối chiếu trực tiếp một đơn thử trước khi nhận khách. Hoàn tiền và xử lý chuyển thừa hiện là thao tác thủ công của quán.

Nguồn [SePay Webhooks](https://developer.sepay.vn/en/sepay-webhooks/tich-hop-webhook) và [QR động](https://docs.sepay.vn/tao-qr-code-vietqr-dong.html).

### Thông báo trên điện thoại

Tạo OneSignal Web Push app cho đúng origin HTTPS. Điền `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY` và `PUBLIC_URL`. File `/OneSignalSDKWorker.js` nằm trong thư mục public của frontend. Dì đăng nhập, mở **Quản lý → Phí giao và thông báo → Nhận báo đơn trên thiết bị này**, rồi cấp quyền. Trên iPhone hỗ trợ Web Push, thêm web vào Màn hình chính và mở web từ biểu tượng đó trước khi cấp quyền.

Khi đặt hàng, một tác vụ gửi thông báo được ghi cùng giao dịch với đơn. Worker gửi cho thiết bị đã đăng ký của quán và thử lại khi lỗi. Danh sách đơn hàng cũng làm mới mỗi năm giây khi đang mở. Nội dung push chỉ báo có đơn mới, không chứa địa chỉ hoặc số điện thoại. [OneSignal](https://documentation.onesignal.com/reference/create-message) · [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)

## Các API chính

Đường dẫn bắt đầu bằng `/api`. Frontend thêm `Authorization: Bearer <access token>` cho yêu cầu đã đăng nhập. Dữ liệu gửi/nhận dùng JSON. API trả lỗi nghiệp vụ ở trường `error`.

| Phương thức và đường dẫn | Người dùng | Mục đích |
| --- | --- | --- |
| GET `/config`, GET `/health` | Công khai | Cấu hình public và trạng thái tiến trình |
| GET `/shop/{slug}` | Công khai | Menu, tồn, topping, đánh giá |
| POST `/shop/{slug}/items`, `/counter/{id}` dưới cùng đường dẫn quán | Chủ quán | Thêm/sửa món, bán một phần tại quầy |
| POST `/shop/{slug}/settings`, `/subscription` dưới đường dẫn quán | Chủ quán | Quy tắc phí giao, đăng ký thiết bị |
| POST `/shop/{slug}/quote` | Khách đã đăng nhập | Báo giá từ địa chỉ |
| GET/POST `/shop/{slug}/orders` | Khách hoặc chủ quán | Xem danh sách được phép hoặc tạo đơn |
| GET `/order/{id}` | Người mua hoặc chủ quán | Chi tiết đơn và chat |
| POST `/order/{id}/state` | Theo vai trò và trạng thái | confirm, propose, accept, cancel, complete |
| POST `/order/{id}/messages`, `/reviews` dưới đường dẫn đơn | Theo vai trò | Nhắn tin hoặc đánh giá món đã mua |
| POST `/shop/{slug}/webhook` | SePay có khóa riêng | Đối soát tiền vào |

## Kiểm thử và triển khai

```sh
cd frontend
npm ci
npm run build
cd ../backend
cargo fmt --check
cargo test --locked
cargo build --locked
```

Kiểm thử tích hợp dùng Python 3 và **database thử riêng**. Script tạo quán, món và đơn thử trong database được chỉ định. Test dùng PostgreSQL thật và mô phỏng nhà cung cấp danh tính ở loopback. Payload thanh toán mô phỏng đi qua cùng endpoint webhook với production. Chạy từ `backend/` sau khi build.

```sh
TEST_DATABASE_URL=postgres://food:localonly@127.0.0.1:5432/food_test python3 tests/smoke.py
```

Tạo database trên trước (ví dụ từ gốc repo chạy `docker compose exec db createdb -U food food_test`). Để kiểm tra hai kích thước màn hình, cài Python Playwright và Chromium, build frontend rồi thêm `CHECK_BROWSER=1` vào lệnh test. Với Chromium đã cài trên máy, đặt `CHROMIUM_PATH` tới executable tương ứng.

Khi triển khai, build frontend bằng `npm ci && npm run build`, build backend bằng `cargo build --release --locked`. Chạy binary với thư mục làm việc `backend/` hoặc đặt `WEB_DIST` là đường dẫn tuyệt đối tới `frontend/dist`. Axum phục vụ cả API và SPA trên cùng origin. Đặt HTTPS reverse proxy trước Axum, cấu hình đúng domain cho nhà cung cấp và cấp giới hạn yêu cầu cho endpoint xác thực/báo giá. Dùng PostgreSQL riêng có sao lưu và quản lý secret trong môi trường của host. Tệp Compose dùng mật khẩu local để phát triển. Đổi thông tin kết nối trước khi đưa lên máy chủ.

Trước buổi bán đầu tiên, thử trên chính điện thoại của Dì: đăng nhập, bật push, khóa màn hình, gửi đơn từ điện thoại khác, kiểm tra thông báo, đặt giao thử bằng địa chỉ thật, khôi phục bằng email/SMS và chuyển một giao dịch thử được phép. Kết quả của các bước này phụ thuộc vào tên miền, tài khoản dịch vụ và thiết bị thực tế.

## GitHub

Repo đích là [trongcheckmateking/Website_Food](https://github.com/trongcheckmateking/Website_Food). Nếu nhận bản đóng gói có `Website_Food.bundle`, có thể khôi phục lịch sử bằng Git:

```sh
git clone -b main Website_Food.bundle Website_Food
cd Website_Food
git remote set-url origin https://github.com/trongcheckmateking/Website_Food.git
git push -u origin main
```

Lệnh push cần tài khoản có quyền ghi. Nếu repo đích đã có commit, fetch và tích hợp lịch sử hoặc đẩy lên nhánh mới để mở pull request. Giữ `backend/.env` ngoài Git.
