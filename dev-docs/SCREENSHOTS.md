# Screenshots

A visual tour of the current moldqueen UI, from the chooser to driving a machine. The
same web client runs on the Pi, in the browser, and inside the Android app. (Back to the
[README](../README.md).)

## Start page (the chooser)

Open moldqueen and you land here. Every layout is a card with the same live
**Generic / Model** and **MK4 / MK6** badges as the app; pick one and drive.

![The moldqueen start page, a chooser of layout cards](../docs/assets/start_page_preview.png)

## Excavator dashboard

The model-specific layout for the Mould King 13112: a landscape dashboard over the HMI
art, with drag-joysticks for the tracks and arms, hold-buttons for rotation and bucket,
a live status light, and a hardware STOP. The menu, settings, connect wizard, language
picker and STOP are the shared chrome (MK4Chrome) that every layout gets.

![The excavator dashboard](../docs/assets/excavator_preview.png)

## Generic layouts (any twelve-motor toy)

Two model-agnostic controllers: a brick-built gamepad and a 12-axis grid. They map
themselves to your machine with a guided auto-assign, so you don't need a bespoke
dashboard for every toy.

![The two generic layouts, a brick-style gamepad and a 12-axis grid](../docs/assets/generic_layout_preview.png)

## Gamepad

Pair a DualSense (or any controller) over Bluetooth and drive, on the excavator and on
the generic layouts, in the browser or in the Android app. Touch keeps working alongside
it. (See [GAMEPAD.md](GAMEPAD.md).)

![PlayStation and Xbox controllers](../docs/assets/controller_example.png)

## On Android (standalone)

The Android app is a second radio core: it owns the phone's Bluetooth, serves the same
client on-device, and needs no Pi. Here it drives a brick-built controller layout.

![moldqueen running standalone on an Android phone](../docs/assets/android_bricks_on_phone_preview.png)

The shared chrome looks the same on the phone. Menu closed, then open:

<p>
  <img src="../docs/assets/android_closed_menu_preview.png" alt="The dashboard on Android, menu closed" width="420">
  <img src="../docs/assets/android_open_menu_preview.png" alt="The same dashboard, menu open" width="420">
</p>

## On the Raspberry Pi

The reference radio core: Python and raw Bluetooth HCI on a Pi with a BLE USB dongle.
It also serves the web client at `http://<pi>:8080/`. (See [QUICKSTART.md](QUICKSTART.md).)

![A Raspberry Pi running the moldqueen radio core](../docs/assets/raspberry_with_code_example.png)

## Run anywhere

Because the radio core sits behind one WebSocket contract, the same UI runs on a Pi, an
Android phone, a laptop, or against an ESP32 core later.

![The same UI on a Pi, an Android phone, a laptop and an ESP32 board](../docs/assets/many_machienes_example.png)
