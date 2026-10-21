# Hướng dẫn đăng extension lên extensions.gnome.org

Quy trình đóng gói, upload và phát hành Wallpaper Coverflow trên
https://extensions.gnome.org (EGO). Cách làm giống `gnome-window-padding`.

## Bước 1: Tự kiểm tra trước khi nộp

Reviewer sẽ cài thử, bật/tắt nhiều lần và đọc toàn bộ code. Mở một GNOME Shell lồng
để test mà không ảnh hưởng phiên đang dùng:

```bash
dbus-run-session -- gnome-shell --nested --wayland
```

**Cẩn thận với cấu hình thật của bạn:** `dbus-run-session` khởi động dconf-service
bằng môi trường hiện tại. Nếu bạn `dconf write` / `gsettings set` bên trong phiên
lồng mà không đổi `HOME` và `XDG_*` **trước khi** chạy `dbus-run-session`, lệnh sẽ
ghi vào dconf thật của bạn (ví dụ làm mất danh sách `enabled-extensions`). Hãy
export `HOME=<thư mục tạm>` cùng các biến `XDG_DATA_HOME`, `XDG_CONFIG_HOME`,
`XDG_CACHE_HOME` ở ngoài, rồi mới chạy `dbus-run-session`, và cài extension vào
`$XDG_DATA_HOME/gnome-shell/extensions/`.

Trong phiên lồng, hãy kiểm tra:

- Mở picker bằng `Ctrl+Super+W`, duyệt bằng chuột, phím mũi tên và cuộn chuột, chọn
  một ảnh (Enter hoặc click) và huỷ bằng `Esc`.
- Thư mục rỗng hoặc không tồn tại chỉ hiện thông báo, không lỗi.
- Tắt extension khi picker đang mở, rồi bật lại, không để lại actor hay phím tắt.
- Mở trang Preferences: đổi thư mục, đổi phím tắt, đổi màu.
- Log không có lỗi hay warning nào từ extension (`journalctl -f -o cat /usr/bin/gnome-shell`).

## Bước 2: Đóng gói file zip

```bash
./pack.sh
```

File kết quả: `release/wallpaper-coverflow@pvlamkhtn.github.io.shell-extension.zip`
(`release/` đã nằm trong `.gitignore`). Zip chỉ chứa file chạy runtime:
`metadata.json`, `extension.js`, `picker.js`, `wallpapers.js`, `prefs.js`,
`stylesheet.css` và `schemas/*.gschema.xml`. Không chứa file schema đã biên dịch (với
GNOME 45 trở lên là bắt buộc không chứa), không có script cài đặt.

`pack.sh` dùng `--extra-source` cho `picker.js` và `wallpapers.js`, vì
`gnome-extensions pack` chỉ tự gồm `extension.js`, `prefs.js`, `stylesheet.css` và
schema. Nếu thêm module `.js` mới, hãy thêm `--extra-source` tương ứng.

Đừng tự thêm trường `"version"` vào `extension/metadata.json`: EGO tự đánh số phiên
bản. Muốn hiển thị số phiên bản dễ đọc, có thể thêm `"version-name": "1.0"`.

## Bước 3: Tạo tài khoản

1. Vào https://extensions.gnome.org, chọn **Log in** rồi **Register**.
2. Xác nhận email.

## Bước 4: Upload

1. Mở https://extensions.gnome.org/upload/
2. Chọn file `.shell-extension.zip` ở Bước 2.
3. Tick ô đồng ý rằng extension dùng giấy phép tương thích GPL (repo dùng
   GPL-2.0-or-later nên hợp lệ).
4. Bấm **Upload**. Extension ở trạng thái **Unreviewed**.

## Bước 5: Chờ review và phản hồi

- Theo dõi ở trang **Your extensions**. Reviewer gửi nhận xét qua email và trên trang
  review. Thời gian chờ thường từ vài ngày đến khoảng 2 tuần.
- Kết quả: **Active** (đã public) hoặc **Rejected** (kèm lý do). Nếu bị từ chối, sửa
  code rồi upload lại zip mới với cùng UUID.

Các điểm reviewer có thể hỏi, nên chuẩn bị sẵn câu trả lời:

- **Dùng `St.ImageContent`, `Cogl.PixelFormat` và `GdkPixbuf`:** giải mã ảnh bằng
  `GdkPixbuf.Pixbuf.new_from_stream_at_scale_async` (chạy ở thread riêng, không chặn
  shell) rồi đưa vào `St.ImageContent` (từ GNOME 48 `set_data()` nhận thêm Cogl context
  ở đầu, code rẽ nhánh theo `PACKAGE_VERSION`; `Clutter.Image` đã bị gỡ ở 48). Cách này tránh `background-image` của St vì nó
  giải mã đồng bộ ảnh gốc, có thể vài chục MB.
- **`Main.layoutManager.modalDialogGroup` và `Main.pushModal`:** picker là overlay
  modal toàn màn hình, cần grab bàn phím và chuột; `disable()` gọi `popModal` và huỷ
  actor.
- **Không có file thực thi hay subprocess:** extension chỉ đọc thư mục ảnh do người
  dùng chọn và ghi hai key trong `org.gnome.desktop.background`.

## Bước 6: Sau khi được duyệt (Active)

- Upload **screenshot** (chụp picker đang mở) và icon nếu muốn trên trang extension.
- Người dùng cài từ website hoặc app **Extension Manager**.
- Thêm link trang EGO vào `README.md` và `README.vi.md`.

## Bước 7: Phát hành bản cập nhật

1. Sửa code. `shell-version` khai báo 46–51 theo review của EGO, nhưng mới test thật trên
   46. Khi có điều kiện, test thêm trên các bản mới và sửa nếu reviewer báo lỗi.
2. Chạy lại `./pack.sh`.
3. Upload lại ở `/upload/` với cùng UUID. Bản cũ vẫn chạy cho đến khi bản mới được duyệt.

## Lưu ý về phiên bản GNOME hỗ trợ

`shell-version` khai báo 46–51; **chỉ 46 được test thực tế**. Code đã được đối chiếu với
các trang "Port Extensions to GNOME Shell 47…51" trên gjs.guide (đều ghi không có thay
đổi nào ở `metadata.json`). Các chỗ dễ vỡ nhất, test lại đầu tiên khi có máy GNOME mới:

- `St.ImageContent.set_data` và `Cogl.PixelFormat` (picker.js): signature đổi ở 48.
- Các vfunc sự kiện của `St.Widget` (`vfunc_motion_event`, `vfunc_key_press_event`...):
  GNOME 51 đánh dấu cách nối signal sự kiện cũ là deprecated, chuyển sang
  `Clutter.KeyController` / `MotionController` / `ScrollController` / `ClickGesture`.
  Nếu vfunc ngừng hoạt động, chuyển sang các controller này.
- `Main.pushModal` / `Main.popModal` (kiểu trả về `Clutter.Grab` từ GNOME 44).
- Prefs: `Gtk.FileDialog` / `Gtk.ColorDialogButton` (GTK 4.10); từ GNOME 47
  `fillPreferencesWindow` được await.
