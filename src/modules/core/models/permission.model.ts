import mongoose, { Schema } from "mongoose";
import { type RAI } from "@packages/acl/types.js";
import type { BaseDocument } from "#/packages/mongoose/plugins/base.plugin.js";

export interface IPermission extends BaseDocument {
    _id: RAI;
    name: string;
    description: string;
    isEnabled: boolean;
}

const PermissionSchema: Schema = new Schema(
    {
        id: { type: String, required: true, unique: true },
        name: { type: String },
        description: { type: String },
        isEnabled: { type: Boolean, default: true },
    },
    {}
);

export const PermissionModel = mongoose.model<IPermission>("Permission", PermissionSchema);