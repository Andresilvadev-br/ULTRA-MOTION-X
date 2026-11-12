/* Compiled against the public header to verify the ABI from C. */
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "ultra_motion_x.h"

#define CHECK(c) do { if (!(c)) { fprintf(stderr, "FAIL %s:%d %s\n", __FILE__, __LINE__, #c); return 1; } } while (0)

int main(void) {
    CHECK(umx_abi_version() == UMX_ABI_VERSION);
    CHECK(strlen(umx_version()) > 0);
    UmxEngine* e = umx_engine_new(0.0);
    CHECK(e != NULL);
    uint64_t v = umx_value_create(e, 0.0);
    CHECK(v != 0);
    CHECK(umx_animate_spring(e, v, 100.0, 300.0, 30.0, 1.0, UMX_PRIORITY_INTERACTION, UMX_POLICY_REPLACE) != 0);
    double t = 0.0;
    int frames = 0;
    while (umx_engine_frame(e, t) == 1 && frames < 10000) { t += 1000.0 / 144.0; frames++; }
    CHECK(fabs(umx_value_get(e, v) - 100.0) < 1e-9);
    UmxEvent ev;
    CHECK(umx_engine_poll_event(e, &ev) == 1 && ev.kind == UMX_EVENT_STARTED);
    CHECK(umx_engine_poll_event(e, &ev) == 1 && ev.kind == UMX_EVENT_COMPLETED);
    CHECK(umx_engine_poll_event(e, &ev) == 0);
    /* error path */
    CHECK(isnan(umx_value_get(e, 12345)));
    CHECK(umx_last_error_code() == UMX_ERR_INVALID_HANDLE);
    /* compile */
    const char* doc = "{\"version\":\"umx/1\",\"components\":{\"b\":{\"properties\":{\"s\":1},\"states\":{\"r\":{\"s\":1},\"p\":{\"s\":0.95}},\"initial\":\"r\",\"transitions\":[{\"to\":\"p\",\"on\":\"down\"}]}}}";
    UmxString* out = umx_compile(doc, strlen(doc));
    CHECK(out != NULL);
    CHECK(strstr(umx_string_ptr(out), "\"ok\":true") != NULL);
    umx_string_free(out);
    CHECK(umx_engine_load_mdl(e, doc, strlen(doc)) == 0);
    uint64_t inst = umx_instance_create(e, "b", 1);
    CHECK(inst != 0);
    CHECK(umx_instance_send(e, inst, "down", 4) == 1);
    for (int i = 0; i < 400; i++) umx_engine_advance(e, 1.0 / 120.0);
    CHECK(fabs(umx_instance_get(e, inst, "s", 1) - 0.95) < 1e-6);
    UmxString* state = umx_instance_state(e, inst);
    CHECK(strcmp(umx_string_ptr(state), "p") == 0);
    umx_string_free(state);
    umx_engine_free(e);
    printf("abi_test: ok (%d frames)\n", frames);
    return 0;
}
