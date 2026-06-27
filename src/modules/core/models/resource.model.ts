import mongoose, { Schema } from "mongoose";
import { type RAI } from "@packages/acl/types.js";
import { type BaseDocument } from "@packages/mongoose/plugins/base.plugin.js";
import type { HttpMethod } from "@packages/acl/define-routes.js";

export interface IResource extends BaseDocument<RAI> {
    _id: RAI;
    method: HttpMethod;
    path: string;
    name: string;
    description: string;

    // Boolean flags to indicate the state of the resource
    is_enabled: boolean;
    is_root: boolean;

    // Methods of the resource
    enable(): Promise<IResource>;
    disable(): Promise<IResource>;

}

const ResourceSchema: Schema = new Schema(
    {
        _id: { type: String, required: true},
        method: { type: String, required: true },
        path: { type: String, required: true },
        name: { type: String },
        description: { type: String },

        is_enabled: { type: Boolean, default: true },
        is_root: { type: Boolean, default: false },
    },
    {
        methods: {
            enable: async function (this: IResource) {
                this.is_enabled = true;
                await this.save();
                return this;
            },
            disable: async function (this: IResource) {
                this.is_enabled = false;
                await this.save();
                return this;
            },
        },
    }
);

/**
 * Coumpound index to ensure that the combination of method and path is unique across all resources.
 * This prevents the creation of multiple resources with the same method and path.
 */
ResourceSchema.index({ method: 1, path: 1 }, { unique: true });

/**
 * Compound index to make query operations on is_enabled and _id more efficient. 
 * This is useful for filtering resources based on their enabled state and their unique identifier.
 */
ResourceSchema.index({ is_enabled: 1, _id: 1 });

export const ResourceModel = mongoose.model<IResource>("Resource", ResourceSchema);