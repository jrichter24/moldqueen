/*
 * esp32-core first app: run the MouldKingCrypt byte-exact self-test at boot and
 * print PASS/FAIL over the serial console, then idle. This proves the C crypt
 * port on the real ESP32-S3 (and that the 16MB-flash / octal-PSRAM skeleton
 * builds + boots). No radio / NimBLE / WS server yet — that comes next.
 */
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mk_crypt_selftest.h"

void app_main(void)
{
    printf("\n== esp32-core MouldKingCrypt on-device self-test ==\n");
    int failed = mk_crypt_selftest();
    if (failed == 0)
        printf("RESULT: ALL VECTORS BYTE-EXACT vs the Python/Kotlin reference (PASS)\n");
    else
        printf("RESULT: %d check(s) FAILED\n", failed);

    while (1) {
        vTaskDelay(pdMS_TO_TICKS(10000));
        printf("(crypt self-test complete: %s; idle)\n", failed == 0 ? "PASS" : "FAIL");
    }
}
